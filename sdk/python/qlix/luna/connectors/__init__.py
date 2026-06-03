"""Data source connectors for Deep Research."""

from qlix.luna.connectors._stubs import (
    Attachment,
    BaseConnector,
    Document,
    SyncStatus,
)
from qlix.luna.connectors.store import KnowledgeStore

__all__ = ["Attachment", "BaseConnector", "Document", "KnowledgeStore", "SyncStatus"]

# Auto-register built-in connectors
import qlix.luna.connectors.obsidian  # noqa: F401

try:
    import qlix.luna.connectors.gmail  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.gmail_imap  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.gdrive  # noqa: F401
except ImportError:
    pass  # httpx may not be installed

try:
    import qlix.luna.connectors.notion  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.granola  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.gcontacts  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.imessage  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.apple_notes  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.apple_music  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.apple_contacts  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.slack_connector  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.outlook  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.gcalendar  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.dropbox  # noqa: F401
except ImportError:
    pass  # httpx may not be installed

try:
    import qlix.luna.connectors.whatsapp  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.oura  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.apple_health  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.strava  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.spotify  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.google_tasks  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.weather  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.github_notifications  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.hackernews  # noqa: F401
except ImportError:
    pass

try:
    import qlix.luna.connectors.news_rss  # noqa: F401
except ImportError:
    pass
