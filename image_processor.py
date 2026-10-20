from io import BytesIO

from PIL import (
    Image,
    ImageOps,
    UnidentifiedImageError
)


# Maximum uploaded image size: 5 MB
MAX_IMAGE_SIZE = 5 * 1024 * 1024

# Maximum image dimensions after resizing
MAX_DIMENSION = 1600

# Reject unusually large decoded images
MAX_PIXELS = 16_000_000

Image.MAX_IMAGE_PIXELS = MAX_PIXELS

SUPPORTED_FORMATS = {
    "PNG",
    "JPEG",
    "WEBP"
}


class ImageProcessingError(Exception):
    pass


def process_image(data: bytes) -> bytes:

    if not data:
        raise ImageProcessingError(
            "The image is empty."
        )

    if len(data) > MAX_IMAGE_SIZE:
        raise ImageProcessingError(
            "Image exceeds the 5 MB size limit."
        )

    try:

        with Image.open(BytesIO(data)) as image:

            # Check the actual image format.
            if image.format not in SUPPORTED_FORMATS:
                raise ImageProcessingError(
                    "Only PNG, JPG and WEBP images are supported."
                )

            # Prevent excessively large images.
            if image.width * image.height > MAX_PIXELS:
                raise ImageProcessingError(
                    "Image dimensions are too large."
                )

            # Decode the image.
            image.load()

            # Correct orientation using image metadata.
            processed = ImageOps.exif_transpose(image)

            # Resize large images while preserving aspect ratio.
            processed.thumbnail(
                (MAX_DIMENSION, MAX_DIMENSION),
                Image.Resampling.LANCZOS
            )

            # Normalise the image.
            if processed.mode not in ("RGB", "RGBA"):
                processed = processed.convert("RGB")

            output = BytesIO()

            processed.save(
                output,
                format="PNG",
                optimize=True
            )

            result = output.getvalue()

            if len(result) > 8 * 1024 * 1024:
                raise ImageProcessingError(
                    "Processed image is too large."
                )

            return result

    except ImageProcessingError:
        raise

    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning
    ):
        raise ImageProcessingError(
            "The uploaded image could not be processed."
        )