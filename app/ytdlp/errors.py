import re

def translate_ytdlp_error(raw_error: str) -> str:
    if not raw_error:
        return "An unknown error occurred while processing the media."
    err = raw_error.strip()
    low = err.lower()

    if "sign in to confirm you’re not a bot" in low or "sign in to confirm you're not a bot" in low:
        return "Provider requires bot verification. Please configure cookies_file or try again later."
    if "confirm your age" in low or "age restricted" in low:
        return "This video is age-restricted and requires authentication."
    if "private video" in low or "this video is private" in low:
        return "This video is private and cannot be downloaded."
    if "video unavailable" in low or "this video is unavailable" in low or "has been removed" in low:
        return "This video is unavailable or has been removed."
    if "not available in your country" in low or "geo-restricted" in low or "geoblocked" in low:
        return "This video is not available in the server region (Frankfurt)."
    if "requested format is not available" in low or "format not available" in low:
        return "The requested stream format is no longer available."
    if "too many requests" in low or "http error 429" in low:
        return "Provider rate limit reached. Please wait a few minutes before trying again."
    if "unsupported url" in low or "is not a valid url" in low:
        return "The provided link is not a supported media URL."
    if "timed out" in low or "timeout" in low:
        return "The download request timed out."

    cleaned = re.sub(r"ERROR:\s*", "", err)
    cleaned = re.sub(r"\[.*?\]\s*", "", cleaned)
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    if lines:
        return lines[-1][:200]
    return "Failed to download media from the provided link."
