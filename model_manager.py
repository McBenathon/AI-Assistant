# =====================================
# OLLAMA MODEL MANAGEMENT
# =====================================


async def get_available_chat_models(ollama_client):

    """
    Retrieve installed Ollama models.

    Only return models that support
    text-generation/chat functionality.
    """

    # Retrieve installed models.
    response = await ollama_client.list()

    available_models = []

    for model in response.models:

        model_name = model.model

        if not model_name:
            continue

        try:

            # Retrieve the model's capabilities.
            information = await ollama_client.show(
                model=model_name
            )

            capabilities = (
                information.capabilities or []
            )

            # Exclude embedding-only models.
            if "completion" not in capabilities:
                continue

            supports_vision = (
                "vision" in capabilities
            )

            details = model.details

            available_models.append({

                "name": model_name,

                "supports_vision": supports_vision,

                "parameter_size": (
                    details.parameter_size
                    if details
                    else None
                ),

                "quantization": (
                    details.quantization_level
                    if details
                    else None
                )
            })

        except Exception as error:

            print(
                "Unable to inspect model:",
                model_name,
                repr(error)
            )

    # Sort models alphabetically.
    available_models.sort(
        key=lambda item: item["name"].lower()
    )

    return available_models