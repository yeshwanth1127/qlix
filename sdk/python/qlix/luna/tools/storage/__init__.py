"""Storage primitive — persistent searchable storage."""

from __future__ import annotations

# Always-available backend
import qlix.luna.tools.storage.sqlite  # noqa: F401

# Optional backends — import to trigger registration
try:
    import qlix.luna.tools.storage.bm25  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.storage.faiss_backend  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.storage.colbert_backend  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.storage.hybrid  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.tools.storage.dense  # noqa: F401
except ImportError:
    pass

from qlix.luna.tools.storage._stubs import MemoryBackend, RetrievalResult
from qlix.luna.tools.storage.chunking import Chunk, ChunkConfig, chunk_text
from qlix.luna.tools.storage.context import ContextConfig, inject_context
from qlix.luna.tools.storage.ingest import ingest_path, read_document

__all__ = [
    "Chunk",
    "ChunkConfig",
    "ContextConfig",
    "MemoryBackend",
    "RetrievalResult",
    "chunk_text",
    "inject_context",
    "ingest_path",
    "read_document",
]
