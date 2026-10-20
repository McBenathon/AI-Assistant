from io import BytesIO
from pathlib import Path

from pypdf import PdfReader


# Maximum uploaded file size: 2 MB
MAX_FILE_SIZE = 2 * 1024 * 1024

# Maximum extracted characters sent to the AI
MAX_TEXT_LENGTH = 16000

SUPPORTED_TEXT_EXTENSIONS = {
    ".py",
    ".gd",
    ".java",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
    ".html",
    ".css",
    ".md",
    ".txt",
    ".log",
    ".xml",
    ".yaml",
    ".yml",
    ".toml",
    ".sql",
    ".sh",
    ".csv"
}


class FileProcessingError(Exception):
    pass


def process_file(filename, data):

    extension = Path(filename).suffix.lower()

    if len(data) > MAX_FILE_SIZE:
        raise FileProcessingError(
            "File exceeds the 2 MB size limit."
        )

    if extension == ".pdf":
        text = extract_pdf_text(data)

    elif extension in SUPPORTED_TEXT_EXTENSIONS:
        text = extract_text_file(data)

    else:
        raise FileProcessingError(
            f"Unsupported file type: {extension}"
        )

    if not text.strip():
        raise FileProcessingError(
            "No readable text was found in this file."
        )

    truncated = len(text) > MAX_TEXT_LENGTH

    return {
        "text": text[:MAX_TEXT_LENGTH],
        "truncated": truncated
    }


def extract_text_file(data):

    try:
        text = data.decode("utf-8-sig")

    except UnicodeDecodeError:
        raise FileProcessingError(
            "This file is not valid UTF-8 text."
        )

    if "\x00" in text:
        raise FileProcessingError(
            "The uploaded file appears to contain binary data."
        )

    return text


def extract_pdf_text(data):

    try:
        reader = PdfReader(BytesIO(data))

        if reader.is_encrypted:
            raise FileProcessingError(
                "Password-protected PDFs are not supported."
            )

        extracted_pages = []

        for page in reader.pages[:50]:

            page_text = page.extract_text() or ""

            extracted_pages.append(page_text)

            if sum(
                len(text) for text in extracted_pages
            ) > MAX_TEXT_LENGTH:
                break

        return "\n\n".join(extracted_pages)

    except FileProcessingError:
        raise

    except Exception:
        raise FileProcessingError(
            "Unable to read the PDF document."
        )