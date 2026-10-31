"""Roster mapping by forum, hall, and case category.

Judge-level matching is intentionally excluded: bench.judges data is
internal-only pending counsel clearance (PX-9, ME-6, D-050).
"""


def mapping_key(forum, hall, case_category):
    """Return the lookup key for a roster entry.

    Judge name is deliberately not part of the key.
    """
    return (forum, hall, case_category)


def find_roster(rosters, forum, hall, case_category):
    """Find a roster entry matching forum, hall, and case category."""
    key = mapping_key(forum, hall, case_category)
    for roster in rosters:
        if (roster.get("forum"), roster.get("hall"), roster.get("case_category")) == key:
            return roster
    return None