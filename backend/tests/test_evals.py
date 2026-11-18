"""Phase 7: the evaluation set - scoring rules and an offline run with the fake model."""

import json

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.evals.run import DATASET, run_eval, to_markdown, write_report
from app.evals.scoring import TurnResult, normalize, prices_in, score_case
from app.models import Tenant


def test_normalize_numbers_in_any_script():
    assert normalize("Cleaning: 1.500 TRY") == "cleaning: 1500 try"
    assert normalize("1,500.00 TL") == "1500.00 tl"
    assert normalize("١٬٥٠٠ ليرة") == "1500 ليرة"  # Arabic digits and separator
    assert normalize("۶۰۰۰ لیر") == "6000 لیر"  # Persian digits
    assert normalize("İstanbul") == "i̇stanbul".casefold()


def test_prices_found_but_times_are_not():
    assert prices_in("Cleaning costs 1,500 TRY, whitening ₺6.000 and a check-up 900 TL.") == {"1500", "6000", "900"}
    assert prices_in("Open 09:00-14:00 on Saturday, call +90 216 555 0199.") == set()
    assert prices_in("It is 849.90 TRY") == {"849.90"}


def answer(text, **kw) -> TurnResult:
    return TurnResult(answer=text, **kw)


def test_score_case_checks():
    case = {"language": "en", "checks": {"contains_any": ["14:00"], "cites": True, "only_prices": ["900"],
                                          "not_contains": ["heart surgery"], "tools": ["check_availability"]}}
    good = answer("We are open on Saturday until 14:00 [1]. A check-up is 900 TRY.", cited=[{"n": 1}],
                  tools=["check_availability"])
    assert all(ok for _, ok, _ in score_case(case, [good], 0))

    bad = answer("We are open on Saturday morning. Implants cost 25,000 TRY.", tools=[])
    failed = {n for n, ok, _ in score_case(case, [bad], 0) if not ok}
    assert failed == {"contains_any", "cites", "only_prices", "tools"}


def test_score_case_language_booking_status_and_errors():
    case = {"language": "tr", "checks": {"booked": True, "status": "handoff"}}
    r = answer("Randevunuz oluşturuldu, ekibimiz sizinle iletişime geçecek.", status="handoff")
    assert all(ok for _, ok, _ in score_case(case, [r], 1))
    wrong_lang = answer("Your appointment is booked and our team will contact you.", status="handoff")
    assert ("language", False) in [(n, ok) for n, ok, _ in score_case(case, [wrong_lang], 1)]
    assert [n for n, ok, _ in score_case(case, [r], 0) if not ok] == ["booked"]
    assert score_case(case, [answer("", error="quota")], 0) == [("no_error", False, "quota")]


def test_dataset_is_valid():
    data = json.loads(DATASET.read_text(encoding="utf-8"))
    ids = [c["id"] for c in data["cases"]]
    assert len(ids) == len(set(ids)) >= 15
    assert {c["language"] for c in data["cases"]} == {"tr", "en", "de", "ru", "fr", "ar", "fa", "ur"}
    known = {"language", "contains_any", "contains_all", "not_contains", "only_prices", "cites", "tools",
             "no_tools", "booked", "status"}
    for c in data["cases"]:
        assert c["turns"] and set(c["checks"]) <= known, c["id"]


async def test_offline_eval_run(tmp_path, fake_llm):
    dataset = {
        "version": 1,
        "business": {"name": "Eval test", "documents": [{"title": "Hours", "text": "Open on Saturday 09:00-14:00."}]},
        "cases": [
            {"id": "pass-case", "language": "en", "turns": ["Are you open on Saturday?"],
             "checks": {"contains_any": ["saturday"], "cites": True}},
            {"id": "fail-case", "language": "en", "turns": ["Are you open on Sunday?"],
             "checks": {"contains_any": ["closed"]}},
        ],
    }
    path = tmp_path / "dataset.json"
    path.write_text(json.dumps(dataset), encoding="utf-8")

    report = await run_eval(path, pause=0, log=lambda *_: None)
    s = report["summary"]
    assert s["cases"] == 2 and s["passed"] == 1 and s["pass_rate"] == 0.5
    assert s["by_language"] == {"en": {"passed": 1, "total": 2}}
    assert s["tokens"] == 240 and s["latency_ms"]["p50"] is not None
    fail = next(c for c in report["cases"] if c["id"] == "fail-case")
    assert [c["name"] for c in fail["checks"] if not c["passed"]] == ["contains_any"]

    async with SessionLocal() as db:  # the temporary business is removed afterwards
        assert await db.scalar(select(func.count()).select_from(Tenant)) == 0

    md = write_report(report, tmp_path / "reports").read_text(encoding="utf-8")
    assert "1/2 cases passed (50%)" in md and "`fail-case` | ❌" in md
    assert (tmp_path / "reports" / "latest.json").exists()
    assert to_markdown(report) == md
