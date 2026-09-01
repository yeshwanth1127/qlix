"""Session management — cross-channel persistent sessions.

Supports consolidation and decay.
"""

from __future__ import annotations

import json
import hashlib
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from qlix.luna.core.config import DEFAULT_CONFIG_DIR
from qlix.context_management import build_structured_context, serialize_messages


@dataclass(slots=True)
class SessionIdentity:
    """Canonical user identity across channels."""

    user_id: str
    display_name: str = ""
    # channel_type -> channel_user_id
    channel_ids: Dict[str, str] = field(
        default_factory=dict,
    )


@dataclass(slots=True)
class SessionMessage:
    """A single message within a session."""

    role: str  # "user" | "assistant" | "system"
    content: str
    channel: str = ""
    timestamp: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Session:
    """A conversation session with cross-channel message history."""

    session_id: str = ""
    identity: Optional[SessionIdentity] = None
    messages: List[SessionMessage] = field(default_factory=list)
    created_at: float = 0.0
    last_activity: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def add_message(self, role: str, content: str, *, channel: str = "") -> None:
        self.messages.append(
            SessionMessage(
                role=role,
                content=content,
                channel=channel,
                timestamp=time.time(),
            )
        )
        self.last_activity = time.time()


class SessionStore:
    """SQLite-backed session persistence with consolidation and decay."""

    def __init__(
        self,
        db_path: Union[str, Path] = DEFAULT_CONFIG_DIR / "sessions.db",
        *,
        max_age_hours: float = 24.0,
        consolidation_threshold: int = 100,
    ) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        self._max_age_hours = max_age_hours
        self._consolidation_threshold = consolidation_threshold
        self._create_tables()

    def _create_tables(self) -> None:
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id    TEXT PRIMARY KEY,
                user_id       TEXT,
                display_name  TEXT DEFAULT '',
                channel_ids   TEXT DEFAULT '{}',
                created_at    REAL,
                last_activity REAL,
                metadata      TEXT DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS session_messages (
                id         INTEGER PRIMARY KEY,
                session_id TEXT NOT NULL,
                role       TEXT NOT NULL,
                content    TEXT NOT NULL,
                channel    TEXT DEFAULT '',
                timestamp  REAL,
                metadata   TEXT DEFAULT '{}',
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session
                ON session_messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_user
                ON sessions(user_id);
            CREATE TABLE IF NOT EXISTS session_context_artifacts (
                artifact_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at REAL NOT NULL,
                metadata TEXT DEFAULT '{}',
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            );
            CREATE INDEX IF NOT EXISTS idx_context_artifacts_session
                ON session_context_artifacts(session_id, created_at);
        """)
        self._conn.commit()

    def get_or_create(
        self,
        user_id: str,
        *,
        channel: str = "",
        channel_user_id: str = "",
        display_name: str = "",
    ) -> Session:
        """Get existing session for user or create a new one."""
        row = self._conn.execute(
            "SELECT session_id, user_id, display_name,"
            " channel_ids, created_at, last_activity,"
            " metadata "
            "FROM sessions WHERE user_id = ?"
            " ORDER BY last_activity DESC LIMIT 1",
            (user_id,),
        ).fetchone()

        if row:
            session_id = row[0]
            # Check age
            age_hours = (time.time() - (row[5] or 0)) / 3600
            if age_hours > self._max_age_hours:
                # Session expired, create new
                return self._create_session(
                    user_id,
                    channel,
                    channel_user_id,
                    display_name,
                )

            channel_ids = json.loads(row[3]) if row[3] else {}
            if channel and channel_user_id:
                channel_ids[channel] = channel_user_id
                self._conn.execute(
                    "UPDATE sessions SET channel_ids = ?,"
                    " last_activity = ?"
                    " WHERE session_id = ?",
                    (json.dumps(channel_ids), time.time(), session_id),
                )
                self._conn.commit()

            # Load messages
            messages = self._load_messages(session_id)

            return Session(
                session_id=session_id,
                identity=SessionIdentity(
                    user_id=row[1],
                    display_name=row[2] or display_name,
                    channel_ids=channel_ids,
                ),
                messages=messages,
                created_at=row[4] or 0.0,
                last_activity=row[5] or 0.0,
                metadata=json.loads(row[6]) if row[6] else {},
            )

        return self._create_session(user_id, channel, channel_user_id, display_name)

    def _create_session(
        self,
        user_id: str,
        channel: str,
        channel_user_id: str,
        display_name: str,
    ) -> Session:
        session_id = uuid.uuid4().hex[:16]
        now = time.time()
        channel_ids = {channel: channel_user_id} if channel and channel_user_id else {}
        self._conn.execute(
            "INSERT INTO sessions (session_id, user_id,"
            " display_name, channel_ids,"
            " created_at, last_activity) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, user_id, display_name, json.dumps(channel_ids), now, now),
        )
        self._conn.commit()
        return Session(
            session_id=session_id,
            identity=SessionIdentity(
                user_id=user_id,
                display_name=display_name,
                channel_ids=channel_ids,
            ),
            created_at=now,
            last_activity=now,
        )

    def save_message(
        self,
        session_id: str,
        role: str,
        content: str,
        *,
        channel: str = "",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Persist a message to a session."""
        self._conn.execute(
            "INSERT INTO session_messages"
            " (session_id, role, content,"
            " channel, timestamp, metadata) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                session_id,
                role,
                content,
                channel,
                time.time(),
                json.dumps(metadata or {}),
            ),
        )
        self._conn.execute(
            "UPDATE sessions SET last_activity = ? WHERE session_id = ?",
            (time.time(), session_id),
        )
        self._conn.commit()

        # Check if consolidation is needed
        count = self._conn.execute(
            "SELECT COUNT(*) FROM session_messages WHERE session_id = ?",
            (session_id,),
        ).fetchone()[0]
        if count > self._consolidation_threshold:
            self.consolidate(session_id)

    def consolidate(self, session_id: str) -> None:
        """Compact old messages without discarding their full durable transcript."""
        messages = self._load_messages(session_id)
        if len(messages) <= self._consolidation_threshold // 2:
            return

        split = len(messages) // 2
        old_messages = messages[:split]

        serialized = serialize_messages(old_messages)
        digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        artifact_id = f"session-{digest[:20]}"
        prior_artifacts = [
            str(artifact)
            for message in old_messages
            for artifact in (message.metadata.get("source_artifact_ids") or [])
            if artifact
        ]
        structured = build_structured_context(
            old_messages,
            source_artifact_ids=[*prior_artifacts, artifact_id],
        )
        summary = structured.to_text(max_chars=6000)

        self._conn.execute(
            "INSERT OR IGNORE INTO session_context_artifacts "
            "(artifact_id, session_id, sha256, content, created_at, metadata) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                artifact_id,
                session_id,
                digest,
                serialized,
                time.time(),
                json.dumps({"kind": "session_compaction", "message_count": len(old_messages)}),
            ),
        )

        # Delete old messages
        oldest_ts = old_messages[-1].timestamp if old_messages else 0
        self._conn.execute(
            "DELETE FROM session_messages WHERE session_id = ? AND timestamp <= ?",
            (session_id, oldest_ts),
        )
        # Insert summary as system message
        self._conn.execute(
            "INSERT INTO session_messages"
            " (session_id, role, content,"
            " channel, timestamp, metadata) "
            "VALUES (?, 'system', ?, '', ?, ?)",
            (
                session_id,
                summary,
                time.time(),
                json.dumps(
                    {
                        "kind": "context_compaction",
                        "version": "1.0",
                        "source_artifact_ids": structured.source_artifact_ids,
                        "structured": structured.to_dict(),
                    }
                ),
            ),
        )
        self._conn.commit()

    def get_context_artifact(self, artifact_id: str) -> Dict[str, Any] | None:
        """Read a full transcript retained by structured session compaction."""
        row = self._conn.execute(
            "SELECT artifact_id, session_id, sha256, content, created_at, metadata "
            "FROM session_context_artifacts WHERE artifact_id = ?",
            (artifact_id,),
        ).fetchone()
        if row is None:
            return None
        return {
            "artifact_id": row[0],
            "session_id": row[1],
            "sha256": row[2],
            "content": row[3],
            "created_at": row[4],
            "metadata": json.loads(row[5]) if row[5] else {},
        }

    def decay(self, max_age_hours: Optional[float] = None) -> int:
        """Remove sessions older than max_age_hours. Returns count removed."""
        age = max_age_hours or self._max_age_hours
        cutoff = time.time() - (age * 3600)
        cur = self._conn.execute(
            "SELECT session_id FROM sessions WHERE last_activity < ?",
            (cutoff,),
        )
        session_ids = [row[0] for row in cur.fetchall()]
        for sid in session_ids:
            self._conn.execute(
                "DELETE FROM session_messages WHERE session_id = ?",
                (sid,),
            )
            self._conn.execute(
                "DELETE FROM session_context_artifacts WHERE session_id = ?",
                (sid,),
            )
            self._conn.execute(
                "DELETE FROM sessions WHERE session_id = ?",
                (sid,),
            )
        self._conn.commit()
        return len(session_ids)

    def link_channel(self, session_id: str, channel: str, channel_user_id: str) -> None:
        """Link a channel identity to an existing session."""
        row = self._conn.execute(
            "SELECT channel_ids FROM sessions WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        if row:
            channel_ids = json.loads(row[0]) if row[0] else {}
            channel_ids[channel] = channel_user_id
            self._conn.execute(
                "UPDATE sessions SET channel_ids = ? WHERE session_id = ?",
                (json.dumps(channel_ids), session_id),
            )
            self._conn.commit()

    def list_sessions(
        self,
        *,
        active_only: bool = True,
        limit: int = 50,
    ) -> List[Session]:
        """List sessions, optionally filtering to active only."""
        sql = (
            "SELECT session_id, user_id, display_name,"
            " channel_ids, created_at, last_activity,"
            " metadata FROM sessions"
        )
        params: list = []
        if active_only:
            cutoff = time.time() - (self._max_age_hours * 3600)
            sql += " WHERE last_activity >= ?"
            params.append(cutoff)
        sql += " ORDER BY last_activity DESC LIMIT ?"
        params.append(limit)

        rows = self._conn.execute(sql, params).fetchall()
        sessions = []
        for row in rows:
            sessions.append(
                Session(
                    session_id=row[0],
                    identity=SessionIdentity(
                        user_id=row[1],
                        display_name=row[2] or "",
                        channel_ids=json.loads(row[3]) if row[3] else {},
                    ),
                    created_at=row[4] or 0.0,
                    last_activity=row[5] or 0.0,
                    metadata=json.loads(row[6]) if row[6] else {},
                )
            )
        return sessions

    def _load_messages(self, session_id: str) -> List[SessionMessage]:
        rows = self._conn.execute(
            "SELECT role, content, channel, timestamp, metadata "
            "FROM session_messages WHERE session_id = ? ORDER BY timestamp",
            (session_id,),
        ).fetchall()
        return [
            SessionMessage(
                role=row[0],
                content=row[1],
                channel=row[2] or "",
                timestamp=row[3] or 0.0,
                metadata=json.loads(row[4]) if row[4] else {},
            )
            for row in rows
        ]

    def close(self) -> None:
        self._conn.close()


__all__ = ["Session", "SessionIdentity", "SessionMessage", "SessionStore"]
