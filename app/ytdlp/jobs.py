import asyncio
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from app.core.config import config
from app.core.logging import logger
from app.core.temp import create_session_dir, cleanup_session_dir
from app.ytdlp.download import build_download_command, find_completed_file, clean_filename
from app.ytdlp.errors import translate_ytdlp_error

@dataclass
class Job:
    id: str
    url: str
    video_format_id: str
    audio_format_id: str
    status: str = "queued"
    progress: float = 0.0
    speed: str = ""
    eta: str = ""
    error: str | None = None
    filename: str | None = None
    file_path: Path | None = None
    session_dir: Path | None = None
    created_at: float = 0.0

class JobManager:
    def __init__(self) -> None:
        self.semaphore = asyncio.Semaphore(config.download.max_concurrent_downloads)
        self.jobs: dict[str, Job] = {}
        self.active_count: int = 0

    def create_job(self, url: str, video_format_id: str, audio_format_id: str) -> Job:
        job_id = uuid.uuid4().hex[:12]
        session_dir = create_session_dir(job_id)
        job = Job(
            id=job_id,
            url=url,
            video_format_id=video_format_id,
            audio_format_id=audio_format_id,
            session_dir=session_dir,
            created_at=time.time(),
        )
        self.jobs[job_id] = job
        return job

    def get_job(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def is_server_busy(self) -> bool:
        return self.active_count >= config.download.max_concurrent_downloads

    def cleanup_job(self, job_id: str) -> None:
        job = self.jobs.get(job_id)
        if job and job.session_dir:
            cleanup_session_dir(job.session_dir)
            job.file_path = None

    def sweep_stale_jobs(self, max_age_seconds: int = 1800) -> None:
        now = time.time()
        to_remove = []
        for jid, job in self.jobs.items():
            if now - job.created_at > max_age_seconds:
                if job.session_dir:
                    cleanup_session_dir(job.session_dir)
                to_remove.append(jid)
        for jid in to_remove:
            del self.jobs[jid]

    async def execute_job(self, job: Job) -> None:
        self.active_count += 1
        try:
            async with self.semaphore:
                await self._run_download_process(job)
        finally:
            self.active_count = max(0, self.active_count - 1)

    async def _run_download_process(self, job: Job) -> None:
        job.status = "downloading"
        if not job.session_dir:
            job.session_dir = create_session_dir(job.id)

        outtmpl = str(job.session_dir / "%(title)s.%(ext)s")
        try:
            cmd = build_download_command(
                url=job.url,
                video_format_id=job.video_format_id,
                audio_format_id=job.audio_format_id,
                output_template=outtmpl,
            )
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            cleanup_session_dir(job.session_dir)
            return

        process = None
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout_lines: list[str] = []
            stderr_lines: list[str] = []

            async def read_stream(stream, lines_list, is_stdout=True):
                progress_pattern = re.compile(
                    r"\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?(\S+)\s+at\s+(\S+)\s+ETA\s+(\S+)"
                )
                while True:
                    line_bytes = await stream.readline()
                    if not line_bytes:
                        break
                    line = line_bytes.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    lines_list.append(line)
                    if is_stdout:
                        if "[Merger]" in line or "[ExtractAudio]" in line:
                            job.status = "merging"
                            job.progress = 100.0
                        else:
                            m = progress_pattern.search(line)
                            if m:
                                job.progress = float(m.group(1))
                                job.speed = m.group(3)
                                job.eta = m.group(4)

            reader_task = asyncio.gather(
                read_stream(process.stdout, stdout_lines, is_stdout=True),
                read_stream(process.stderr, stderr_lines, is_stdout=False),
            )

            await asyncio.wait_for(
                asyncio.gather(process.wait(), reader_task),
                timeout=config.download.download_timeout_seconds,
            )

            if process.returncode != 0:
                full_err = "\n".join(stderr_lines or stdout_lines)
                job.status = "failed"
                job.error = translate_ytdlp_error(full_err)
                cleanup_session_dir(job.session_dir)
                return

            completed_file = find_completed_file(job.session_dir)
            if not completed_file:
                job.status = "failed"
                job.error = "File missing after download process finished."
                cleanup_session_dir(job.session_dir)
                return

            job.status = "ready"
            job.progress = 100.0
            job.file_path = completed_file
            job.filename = clean_filename(completed_file.name)

        except asyncio.TimeoutError:
            if process:
                try:
                    process.kill()
                    await process.wait()
                except Exception:
                    pass
            job.status = "failed"
            job.error = "Download timed out."
            cleanup_session_dir(job.session_dir)
        except Exception as exc:
            if process:
                try:
                    process.kill()
                    await process.wait()
                except Exception:
                    pass
            job.status = "failed"
            job.error = translate_ytdlp_error(str(exc))
            cleanup_session_dir(job.session_dir)

job_manager = JobManager()
