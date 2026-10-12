"""Provider/adapter layer - each external system gets its own module here."""

from .cisco import CiscoProvider

__all__ = ["CiscoProvider"]
