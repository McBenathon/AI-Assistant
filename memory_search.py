import math

import database


# Embedding model used for semantic retrieval.
EMBEDDING_MODEL = "nomic-embed-text"

# Maximum number of memories to retrieve.
MAX_RELEVANT_MEMORIES = 5

# Minimum cosine similarity required.
# We can adjust this after testing.
MIN_SIMILARITY = 0.35


def cosine_similarity(vector_a, vector_b):

    if len(vector_a) != len(vector_b):
        return 0.0

    dot_product = sum(
        a * b
        for a, b in zip(vector_a, vector_b)
    )

    magnitude_a = math.sqrt(
        sum(a * a for a in vector_a)
    )

    magnitude_b = math.sqrt(
        sum(b * b for b in vector_b)
    )

    if magnitude_a == 0 or magnitude_b == 0:
        return 0.0

    return dot_product / (
        magnitude_a * magnitude_b
    )


async def find_relevant_memories(
    query,
    ollama_client
):

    if not query.strip():
        return []

    memories = database.get_memories()

    if not memories:
        return []

    # Load previously generated embeddings.
    vectors = database.get_memory_vectors(
        EMBEDDING_MODEL
    )

    # Identify memories without current embeddings.
    missing_memories = [
        memory
        for memory in memories
        if memory["id"] not in vectors
    ]

    # Generate embeddings for new or edited memories.
    if missing_memories:

        texts = [
            "search_document: " + memory["content"][:1500]
            for memory in missing_memories
        ]

        response = await ollama_client.embed(
            model=EMBEDDING_MODEL,
            input=texts
        )

        new_embeddings = response.embeddings

        if len(new_embeddings) != len(missing_memories):
            raise RuntimeError(
                "Embedding response count mismatch."
            )

        new_vectors = [
            (
                memory["id"],
                list(embedding)
            )

            for memory, embedding in zip(
                missing_memories,
                new_embeddings
            )
        ]

        # Save embeddings for future searches.
        database.save_memory_vectors(
            EMBEDDING_MODEL,
            new_vectors
        )

        # Add them to the current search.
        for memory_id, embedding in new_vectors:
            vectors[memory_id] = embedding

    # Generate an embedding for the user's question.
    query_response = await ollama_client.embed(
        model=EMBEDDING_MODEL,
        input="search_query: " + query[-1800:]
    )

    query_vector = query_response.embeddings[0]

    # Calculate similarity against saved memories.
    results = []

    for memory in memories:

        memory_vector = vectors.get(
            memory["id"]
        )

        if memory_vector is None:
            continue

        similarity = cosine_similarity(
            query_vector,
            memory_vector
        )

        if similarity >= MIN_SIMILARITY:

            results.append({
                "id": memory["id"],
                "content": memory["content"],
                "score": round(similarity, 4)
            })

    # Highest similarity first.
    results.sort(
        key=lambda item: item["score"],
        reverse=True
    )

    # Return only the most relevant memories.
    return results[:MAX_RELEVANT_MEMORIES]