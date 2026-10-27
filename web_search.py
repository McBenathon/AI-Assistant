import asyncio

from urllib.parse import urlsplit

from ddgs import DDGS


MAX_RESULTS = 5

MAX_QUERY_LENGTH = 500


class WebSearchError(Exception):
    pass


def valid_web_url(url: str) -> bool:
    try:
        parsed = urlsplit(url)

        return (
            parsed.scheme in ("http", "https")
            and bool(parsed.hostname)
            and not parsed.username
            and not parsed.password
        )

    except ValueError:
        return False


def perform_search(query: str):

    with DDGS(timeout=10) as search_client:

        results = search_client.text(
            query,
            region="uk-en",
            safesearch="on",
            max_results=MAX_RESULTS
        )

    formatted_results = []

    for result in results:

        title = str(
            result.get("title", "")
        ).strip()

        url = str(
            result.get("href", "")
        ).strip()

        description = str(
            result.get("body", "")
        ).strip()

        if not valid_web_url(url):
            continue

        formatted_results.append({
            "title": title[:200],
            "url": url,
            "description": description[:600]
        })

    return formatted_results


async def search_web(query: str):

    query = query.strip()

    if not query:
        raise WebSearchError(
            "Search query cannot be empty."
        )

    if len(query) > MAX_QUERY_LENGTH:
        raise WebSearchError(
            "Search query is too long."
        )

    try:

        # Run the blocking search in a worker
        # thread so FastAPI stays responsive.
        results = await asyncio.to_thread(
            perform_search,
            query
        )

        return results

    except Exception as error:

        print("\n========== DDGS ERROR ==========")

        print("Search query:", query)

        print("Error type:", type(error).__name__)

        print("Error details:", repr(error))

        print("================================\n")

        raise WebSearchError(
            "Unable to retrieve web search results."
        ) from error


def format_search_results(results):

    if not results:
        return "No search results were found."

    formatted = []

    for index, result in enumerate(
        results,
        start=1
    ):

        formatted.append(
            f"[{index}]\n"
            f"Title: {result['title']}\n"
            f"URL: {result['url']}\n"
            f"Description: {result['description']}"
        )

    return "\n\n".join(formatted)



async def search_web_multi(queries: list[str]):

    if not queries:
        return []

    # Avoid duplicate searches.
    unique_queries = []

    for query in queries[:2]:

        query = query.strip()

        if (
            query
            and query.casefold() not in [
                q.casefold()
                for q in unique_queries
            ]
        ):
            unique_queries.append(query)

    # Search queries one at a time.
    for query in unique_queries:

        try:

            print("Searching DDGS for:", query)

            results = await search_web(query)

            if results:

                print(
                    "DDGS returned",
                    len(results),
                    "results."
                )

                # Stop when a query succeeds.
                return results[:MAX_RESULTS]

            print(
                "No results. Trying next query."
            )

        except WebSearchError as error:

            print(
                "DDGS query failed:",
                query,
                repr(error)
            )

    # All searches failed or returned nothing.
    raise WebSearchError(
        "No web search results could be retrieved."
    )