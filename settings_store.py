import sqlite3

from pathlib import Path
from typing import Literal

from pydantic import (
    BaseModel,
    Field,
    model_validator
)


# =====================================
# SETTINGS DATABASE
# =====================================

DATABASE_PATH = (
    Path(__file__).resolve().parent
    / "ai_settings.db"
)


# =====================================
# SETTINGS MODEL
# =====================================

class AISettings(BaseModel):

    temperature: float = Field(
        default=0.6,
        ge=0.0,
        le=1.5
    )

    context_length: int = Field(
        default=4096,
        ge=2048,
        le=16384
    )

    max_output_tokens: int = Field(
        default=2048,
        ge=256,
        le=4096
    )

    default_model: str = Field(
        default="qwen2.5-coder:7b",
        min_length=1,
        max_length=100
    )

    default_search_mode: Literal[
        "off",
        "auto",
        "on"
    ] = "off"

    @model_validator(mode="after")
    def validate_token_limits(self):

        if (
            self.max_output_tokens
            > self.context_length
        ):
            raise ValueError(
                "Maximum output tokens cannot exceed "
                "the context length."
            )

        return self


# =====================================
# INITIALISE DATABASE
# =====================================

def init_settings_database():

    with sqlite3.connect(
        DATABASE_PATH,
        timeout=5
    ) as connection:

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS ai_settings (
                id INTEGER PRIMARY KEY
                    CHECK (id = 1),

                settings_json TEXT NOT NULL
            )
            """
        )


# =====================================
# LOAD SETTINGS
# =====================================

def load_settings() -> AISettings:

    init_settings_database()

    with sqlite3.connect(
        DATABASE_PATH,
        timeout=5
    ) as connection:

        row = connection.execute(
            """
            SELECT settings_json
            FROM ai_settings
            WHERE id = 1
            """
        ).fetchone()

    # No saved settings yet.
    if row is None:
        return AISettings()

    # Validate settings when loading.
    return AISettings.model_validate_json(
        row[0]
    )


# =====================================
# SAVE SETTINGS
# =====================================

def save_settings(settings: AISettings):

    init_settings_database()

    with sqlite3.connect(
        DATABASE_PATH,
        timeout=5
    ) as connection:

        connection.execute(
            """
            INSERT INTO ai_settings (
                id,
                settings_json
            )
            VALUES (1, ?)

            ON CONFLICT(id)
            DO UPDATE SET
                settings_json = excluded.settings_json
            """,
            (
                settings.model_dump_json(),
            )
        )