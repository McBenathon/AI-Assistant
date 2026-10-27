import asyncio
import ipaddress
import re

from urllib.parse import urljoin, urlsplit

import aiohttp

from aiohttp.abc import AbstractResolver
from aiohttp.resolver import DefaultResolver

from bs4 import BeautifulSoup


# =====================================
# WEB READER SETTINGS
# =====================================

# Maximum webpages included in Qwen's context.
MAX_PAGES = 2

# Maximum search results examined.
MAX_CANDIDATES = 5

# Maximum downloaded HTML size: 2 MB.
MAX_PAGE_SIZE = 2 * 1024 * 1024

# Maximum extracted characters per page.
MAX_PAGE_TEXT = 4000

# Maximum request duration.
REQUEST_TIMEOUT = 10

# Maximum redirects per webpage.
MAX_REDIRECTS = 2


class WebReaderError(Exception):
    pass


# =====================================
# URL VALIDATION
# =====================================

def is_allowed_url(url: str) -> bool:

    if not isinstance(url, str):
        return False

    if len(url) > 2048:
        return False

    try:

        parsed = urlsplit(url)

        host = parsed.hostname

        # Only allow HTTPS.
        if parsed.scheme.lower() != "https":
            return False

        if not host:
            return False

        # Restrict connections to standard HTTPS.
        if parsed.port not in (None, 443):
            return False

        # Reject URLs containing credentials.
        if parsed.username is not None:
            return False

        if parsed.password is not None:
            return False

        # Reject IP literals and ambiguous hostnames.
        if not re.fullmatch(
            r"[a-z0-9.-]+",
            host,
            flags=re.I
        ):
            return False

        if re.fullmatch(r"[0-9.]+", host):
            return False

        if "." not in host or ".." in host:
            return False

        if host.endswith("."):
            return False

        # Reject common private/local domains.
        blocked_endings = (
            ".localhost",
            ".local",
            ".internal",
            ".lan",
            ".test",
            ".invalid",
            ".onion",
            ".home.arpa",
            ".example"
        )

        if host == "localhost":
            return False

        if host.endswith(blocked_endings):
            return False

        # Validate domain labels.
        for label in host.split("."):

            if not label or len(label) > 63:
                return False

            if label.startswith("-"):
                return False

            if label.endswith("-"):
                return False

        # Reject literal IP addresses.
        try:
            ipaddress.ip_address(host)
            return False

        except ValueError:
            pass

        return True

    except (ValueError, TypeError):
        return False


# =====================================
# PUBLIC DNS RESOLVER
# =====================================

class PublicDNSResolver(AbstractResolver):

    def __init__(self):

        self._resolver = DefaultResolver()

    async def resolve(
        self,
        host,
        port=0,
        family=0
    ):

        resolved = await self._resolver.resolve(
            host,
            port,
            family=family
        )

        if not resolved:
            raise OSError(
                "Domain did not resolve."
            )

        # Validate the actual destination IP
        # addresses before establishing a connection.
        for item in resolved:

            address = ipaddress.ip_address(
                item["host"]
            )

            if (
                not address.is_global
                or address.is_multicast
            ):
                raise OSError(
                    "Domain resolves to a non-public IP."
                )

        return resolved

    async def close(self):

        await self._resolver.close()


# =====================================
# HTML TEXT EXTRACTION
# =====================================

def extract_page_text(html: str) -> str:

    soup = BeautifulSoup(
        html,
        "html.parser"
    )

    # Remove elements that do not usually
    # contain useful article information.
    for element in soup.select(
        "script, style, nav, footer, header, "
        "aside, form, noscript, svg"
    ):
        element.decompose()

    # Prefer article content over navigation
    # menus and other page elements.
    content = (
        soup.select_one("article")
        or soup.select_one("main")
        or soup.body
        or soup
    )

    lines = [
        line.strip()
        for line in content.get_text(
            separator="\n",
            strip=True
        ).splitlines()
        if line.strip()
    ]

    text = "\n".join(lines)

    return text[:MAX_PAGE_TEXT]


# =====================================
# DOWNLOAD AND READ WEBPAGE
# =====================================

async def read_webpage(
    url: str,
    title: str = ""
):

    if not is_allowed_url(url):
        raise WebReaderError(
            "URL is not an allowed public HTTPS address."
        )

    # Use a resolver that rejects connections
    # to private or otherwise non-public IPs.
    connector = aiohttp.TCPConnector(
        resolver=PublicDNSResolver(),
        use_dns_cache=False,
        limit=2
    )

    timeout = aiohttp.ClientTimeout(
        total=REQUEST_TIMEOUT,
        connect=5
    )

    try:

        async with aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            trust_env=False,
            cookie_jar=aiohttp.DummyCookieJar(),
            headers={
                "User-Agent": "PersonalAIAssistant/1.0",
                "Accept": "text/html"
            }
        ) as session:

            current_url = url

            for redirect_count in range(
                MAX_REDIRECTS + 1
            ):

                # Validate every redirect destination.
                if not is_allowed_url(current_url):
                    raise WebReaderError(
                        "Redirected to an unsafe URL."
                    )

                async with session.get(
                    current_url,
                    allow_redirects=False
                ) as response:

                    # Handle redirects manually.
                    if response.status in (
                        301, 302, 303, 307, 308
                    ):

                        location = response.headers.get(
                            "Location"
                        )

                        if (
                            not location
                            or redirect_count >= MAX_REDIRECTS
                        ):
                            raise WebReaderError(
                                "Too many redirects."
                            )

                        current_url = urljoin(
                            current_url,
                            location
                        )

                        continue

                    if response.status != 200:
                        raise WebReaderError(
                            f"Website returned HTTP "
                            f"{response.status}."
                        )

                    content_type = response.headers.get(
                        "Content-Type",
                        ""
                    ).lower()

                    if "text/html" not in content_type:
                        raise WebReaderError(
                            "This result is not an HTML webpage."
                        )

                    # Reject oversized responses when
                    # the server reports their size.
                    content_length = response.headers.get(
                        "Content-Length"
                    )

                    if (
                        content_length
                        and content_length.isdecimal()
                        and int(content_length) > MAX_PAGE_SIZE
                    ):
                        raise WebReaderError(
                            "Webpage exceeds the size limit."
                        )

                    data = bytearray()

                    # Stream content to enforce a real
                    # download-size limit.
                    async for chunk in (
                        response.content.iter_chunked(8192)
                    ):

                        data.extend(chunk)

                        if len(data) > MAX_PAGE_SIZE:
                            raise WebReaderError(
                                "Webpage exceeds the size limit."
                            )

                    # Decode the HTML.
                    try:
                        html = bytes(data).decode(
                            response.charset or "utf-8",
                            errors="replace"
                        )

                    except LookupError:
                        html = bytes(data).decode(
                            "utf-8",
                            errors="replace"
                        )

                    # Extract readable webpage text.
                    extracted_text = extract_page_text(
                        html
                    )

                    if not extracted_text:
                        raise WebReaderError(
                            "No readable text was extracted."
                        )

                    return {
                        "title": title,
                        "url": current_url,
                        "content": extracted_text,
                        "characters": len(extracted_text)
                    }

            raise WebReaderError(
                "Too many redirects."
            )

    except (
        aiohttp.ClientError,
        asyncio.TimeoutError,
        OSError
    ) as error:

        raise WebReaderError(
            f"Unable to retrieve webpage: {error}"
        ) from error


# =====================================
# READ SEARCH RESULTS
# =====================================

async def read_search_results(results):

    candidates = []

    seen = set()

    # Select eligible public websites.
    for result in results:

        url = result.get("url", "")

        if not is_allowed_url(url):
            continue

        if url in seen:
            continue

        seen.add(url)

        candidates.append(result)

        if len(candidates) >= MAX_CANDIDATES:
            break

    # Limit simultaneous downloads.
    semaphore = asyncio.Semaphore(2)

    async def try_read(result):

        async with semaphore:

            try:

                return await read_webpage(
                    result["url"],
                    result.get("title", "")
                )

            except WebReaderError as error:

                print(
                    "Skipped webpage:",
                    result["url"],
                    str(error)
                )

                return None

    # Read candidates concurrently.
    pages = await asyncio.gather(
        *[
            try_read(result)
            for result in candidates
        ]
    )

    # Keep up to two successfully read pages.
    return [
        page
        for page in pages
        if page is not None
    ][:MAX_PAGES]


# =====================================
# FORMAT WEBPAGE INFORMATION
# =====================================

def format_read_pages(pages):

    if not pages:
        return "No webpage contents were retrieved."

    formatted = []

    for index, page in enumerate(
        pages,
        start=1
    ):

        formatted.append(
            f"[Web document {index}]\n"
            f"Title: {page['title']}\n"
            f"URL: {page['url']}\n"
            f"Content:\n{page['content']}"
        )

    return "\n\n".join(formatted)