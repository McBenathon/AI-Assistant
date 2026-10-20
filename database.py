import sqlite3
import json
from pathlib import Path
from datetime import datetime, timezone

DATABASE_PATH = Path(__file__).parent / "assistant.db"


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_database():
    with get_connection() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT 'New Chat',
                created_at TEXT NOT NULL
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id)
                    REFERENCES conversations(id)
                    ON DELETE CASCADE
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        db.execute("""
            INSERT OR IGNORE INTO settings (key, value)
            VALUES ('memory_enabled', 'true')
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS memory_vectors (
                memory_id INTEGER PRIMARY KEY,
                model TEXT NOT NULL,
                embedding_json TEXT NOT NULL,

                FOREIGN KEY (memory_id)
                    REFERENCES memories(id)
                    ON DELETE CASCADE
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL,
                message_id INTEGER,
                filename TEXT NOT NULL,
                extracted_text TEXT NOT NULL,
                created_at TEXT NOT NULL,

                FOREIGN KEY (conversation_id)
                    REFERENCES conversations(id)
                    ON DELETE CASCADE,

                FOREIGN KEY (message_id)
                    REFERENCES messages(id)
                    ON DELETE CASCADE
            )
        """)

def create_conversation():
    with get_connection() as db:
        cursor = db.execute(
            """
            INSERT INTO conversations (created_at)
            VALUES (?)
            """,
            (datetime.now(timezone.utc).isoformat(),)
        )

        return cursor.lastrowid


def get_conversations():
    with get_connection() as db:
        rows = db.execute("""
            SELECT * FROM conversations
            ORDER BY id DESC
        """).fetchall()

        return [dict(row) for row in rows]


def get_messages(conversation_id):
    with get_connection() as db:
        rows = db.execute("""
            SELECT role, content
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id ASC
        """, (conversation_id,)).fetchall()

        return [dict(row) for row in rows]


def get_model_messages(conversation_id):
    with get_connection() as db:
        rows = db.execute(
            """
            SELECT id, role, content
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id ASC
            """,
            (conversation_id,)
        ).fetchall()

        # Use the most recent 20 messages as model context.
        recent_rows = rows[-20:]

        result = []

        for index, row in enumerate(recent_rows):
            content = row["content"]

            # Include file content only for the most recent
            # six messages, to avoid excessive context usage.
            if index >= len(recent_rows) - 6:

                files = db.execute(
                    """
                    SELECT filename, extracted_text
                    FROM attachments
                    WHERE message_id = ?
                    """,
                    (row["id"],)
                ).fetchall()

                for file in files:
                    content += (
                        "\n\n[Attached file: "
                        + file["filename"]
                        + "]\n"
                        + file["extracted_text"]
                        + "\n[End of attached file]"
                    )

            result.append({
                "role": row["role"],
                "content": content
            })

        return result


def save_message(conversation_id, role, content):
    with get_connection() as db:
        db.execute("""
            INSERT INTO messages (
                conversation_id,
                role,
                content,
                created_at
            )
            VALUES (?, ?, ?, ?)
        """, (
            conversation_id,
            role,
            content,
            datetime.now(timezone.utc).isoformat()
        ))


def update_title(conversation_id, title):
    with get_connection() as db:
        db.execute("""
            UPDATE conversations
            SET title = ?
            WHERE id = ?
        """, (title, conversation_id))


def delete_conversation(conversation_id):
    with get_connection() as db:
        db.execute(
            "DELETE FROM conversations WHERE id = ?",
            (conversation_id,)
        )

def create_memory(content):
    with get_connection() as db:
        cursor = db.execute(
            """
            INSERT INTO memories (content, created_at)
            VALUES (?, ?)
            """,
            (
                content,
                datetime.now(timezone.utc).isoformat()
            )
        )

        return cursor.lastrowid


def get_memories():
    with get_connection() as db:
        rows = db.execute("""
            SELECT id, content, created_at
            FROM memories
            ORDER BY id DESC
        """).fetchall()

        return [dict(row) for row in rows]


def delete_memory(memory_id):
    with get_connection() as db:
        cursor = db.execute(
            "DELETE FROM memories WHERE id = ?",
            (memory_id,)
        )

        return cursor.rowcount > 0

def update_memory(memory_id, content):

    with get_connection() as db:

        cursor = db.execute(
            """
            UPDATE memories
            SET content = ?
            WHERE id = ?
            """,
            (content, memory_id)
        )

        if cursor.rowcount > 0:

            db.execute(
                """
                DELETE FROM memory_vectors
                WHERE memory_id = ?
                """,
                (memory_id,)
            )

        return cursor.rowcount > 0


def get_memory_enabled():
    with get_connection() as db:
        row = db.execute(
            """
            SELECT value
            FROM settings
            WHERE key = 'memory_enabled'
            """
        ).fetchone()

        return row is not None and row["value"] == "true"


def set_memory_enabled(enabled):
    with get_connection() as db:
        db.execute(
            """
            INSERT INTO settings (key, value)
            VALUES ('memory_enabled', ?)
            ON CONFLICT(key)
            DO UPDATE SET value = excluded.value
            """,
            ("true" if enabled else "false",)
        )

def get_memory_vectors(model):

    with get_connection() as db:

        rows = db.execute(
            """
            SELECT memory_id, embedding_json
            FROM memory_vectors
            WHERE model = ?
            """,
            (model,)
        ).fetchall()

        return {
            row["memory_id"]: json.loads(
                row["embedding_json"]
            )
            for row in rows
        }

def save_memory_vectors(model, vectors):

    if not vectors:
        return

    with get_connection() as db:

        db.executemany(
            """
            INSERT INTO memory_vectors (
                memory_id,
                model,
                embedding_json
            )

            VALUES (?, ?, ?)

            ON CONFLICT(memory_id)
            DO UPDATE SET
                model = excluded.model,
                embedding_json = excluded.embedding_json
            """,
            [
                (
                    memory_id,
                    model,
                    json.dumps(embedding)
                )

                for memory_id, embedding in vectors
            ]
        )

def conversation_exists(conversation_id):
    with get_connection() as db:
        row = db.execute(
            """
            SELECT id
            FROM conversations
            WHERE id = ?
            """,
            (conversation_id,)
        ).fetchone()

        return row is not None


def save_attachment(conversation_id, filename, extracted_text):
    with get_connection() as db:
        cursor = db.execute(
            """
            INSERT INTO attachments (
                conversation_id,
                filename,
                extracted_text,
                created_at
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                conversation_id,
                filename,
                extracted_text,
                datetime.now(timezone.utc).isoformat()
            )
        )

        return cursor.lastrowid


def get_pending_attachment(conversation_id, attachment_id):
    with get_connection() as db:
        row = db.execute(
            """
            SELECT id, filename, extracted_text
            FROM attachments
            WHERE id = ?
              AND conversation_id = ?
              AND message_id IS NULL
            """,
            (attachment_id, conversation_id)
        ).fetchone()

        return dict(row) if row else None

def save_exchange(
    conversation_id,
    user_content,
    assistant_content,
    attachment_id=None
):
    now = datetime.now(timezone.utc).isoformat()

    with get_connection() as db:

        cursor = db.execute(
            """
            INSERT INTO messages (
                conversation_id,
                role,
                content,
                created_at
            )
            VALUES (?, 'user', ?, ?)
            """,
            (conversation_id, user_content, now)
        )

        user_message_id = cursor.lastrowid

        if attachment_id is not None:
            cursor = db.execute(
                """
                UPDATE attachments
                SET message_id = ?
                WHERE id = ?
                  AND conversation_id = ?
                  AND message_id IS NULL
                """,
                (
                    user_message_id,
                    attachment_id,
                    conversation_id
                )
            )

            if cursor.rowcount != 1:
                raise ValueError("Attachment is unavailable.")

        db.execute(
            """
            INSERT INTO messages (
                conversation_id,
                role,
                content,
                created_at
            )
            VALUES (?, 'assistant', ?, ?)
            """,
            (conversation_id, assistant_content, now)
        )

        previous_count = db.execute(
            """
            SELECT COUNT(*)
            FROM messages
            WHERE conversation_id = ?
            """,
            (conversation_id,)
        ).fetchone()[0]

        if previous_count == 2:
            db.execute(
                """
                UPDATE conversations
                SET title = ?
                WHERE id = ?
                """,
                (user_content[:40], conversation_id)
            )

def get_display_messages(conversation_id):

    with get_connection() as db:

        rows = db.execute(
            """
            SELECT id, role, content
            FROM messages
            WHERE conversation_id = ?
            ORDER BY id ASC
            """,
            (conversation_id,)
        ).fetchall()

        result = []

        for row in rows:

            attachments = db.execute(
                """
                SELECT filename
                FROM attachments
                WHERE message_id = ?
                ORDER BY id ASC
                """,
                (row["id"],)
            ).fetchall()

            result.append({
                "role": row["role"],
                "content": row["content"],
                "attachments": [
                    attachment["filename"]
                    for attachment in attachments
                ]
            })

        return result