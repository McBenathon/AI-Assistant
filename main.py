import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from ollama import AsyncClient, ResponseError

app = FastAPI(title="AI Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

ollama_client = AsyncClient(host="http://127.0.0.1:11434")

SYSTEM_PROMPT = """
You are a helpful AI assistant specialising in programming,
debugging, software development, and answering general questions.

Provide accurate, clear, and useful answers.
When writing code, explain important implementation details.
"""


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1)
    model: str = "qwen2.5-coder:7b"


@app.get("/")
async def home():
    return {"status": "online"}


@app.get("/models")
async def get_models():
    response = await ollama_client.list()

    return {
        "models": [model.model for model in response.models]
    }


@app.post("/chat")
async def chat(request: ChatRequest):

    # Only accept user and assistant messages
    for message in request.messages:
        if message.role not in ("user", "assistant"):
            raise HTTPException(
                status_code=400,
                detail="Invalid message role."
            )

    async def generate():
        try:
            messages = [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                }
            ]

            messages.extend([
                {
                    "role": message.role,
                    "content": message.content
                }
                for message in request.messages
            ])

            stream = await ollama_client.chat(
                model=request.model,
                messages=messages,
                stream=True
            )

            async for chunk in stream:
                content = chunk.message.content or ""

                if content:
                    yield json.dumps({
                        "type": "token",
                        "content": content
                    }) + "\n"

            yield json.dumps({
                "type": "done"
            }) + "\n"

        except ResponseError as error:
            yield json.dumps({
                "type": "error",
                "content": error.error
            }) + "\n"

        except Exception:
            yield json.dumps({
                "type": "error",
                "content": "Unable to communicate with Ollama."
            }) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"X-Content-Type-Options": "nosniff"}
    )