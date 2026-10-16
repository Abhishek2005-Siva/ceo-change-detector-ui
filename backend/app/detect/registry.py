"""Every detector in one list, and the runner that applies all of them to a filing."""
from typing import Callable, List, Optional

from .families import Auditor, Bankruptcy, Delisting, Family, Votes
from .families2 import CFO, Acquisition, Agreements, Equity, Guidance, Restructuring

REGISTRY: List[Family] = [
    Bankruptcy(), Delisting(), Auditor(), Votes(), CFO(), Acquisition(), Agreements(), Equity(), Guidance(), Restructuring(),
]


def run_all(plain: str, tables: str, filing_date: str, company: str = "", exhibit: Optional[str] = None,
            on_status: Optional[Callable[[str, bool], None]] = None) -> List[dict]:
    """Runs every detector; one whose Item is absent from the filing reports applicable=False cheaply."""
    out = []
    for fam in REGISTRY:
        present = fam.present(plain, tables)
        if present and on_status:
            on_status(fam.title, not fam.loaded)
        try:
            out.append(fam.run(plain, tables, filing_date, company=company, exhibit=exhibit))
        except Exception as exc:  # one failing detector must not hide the others
            out.append({**fam.not_applicable(), "applicable": present, "error": f"{type(exc).__name__}: {exc}"})
    return out
