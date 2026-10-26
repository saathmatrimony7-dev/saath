"""Labelled pair corpus for the A6 screening eval (P3-06, exit criterion 2).

Generation method (ADR-0008: documented, synthetic only, never real user data):
- 60 Stage-2 pairs authored by the development agent against DESIGN.md §7.2:
  each side carries profile enums, preference enums and 1-2 soft-preference
  stances on a shared topic; the expected verdict is the ground truth a
  careful human matchmaker would give for those stances.
  Split per plan Q3: en 30 / hi (Devanagari) 18 / Hinglish (Roman Hindi) 12.
  16 items are adversarial near-misses (`adversarial=True`): superficially
  compatible stances hiding one real tension (labelled partial/conflict) or
  aligned wording over a hard value clash (labelled incompatible).
- 6 Stage-1 items are deterministic short-circuits (Core hard filters fail;
  reason codes listed, no LLM involved). They must all rate INCOMPATIBLE and
  are excluded from the false-incompatible denominator.
- The false-incompatible bar (≤10%, DESIGN.md §19 exit criterion 2) is
  measured over the 44 Stage-2 items labelled compatible/partial: hiding a
  good match is the costliest error (§17).
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Entry helpers
# ---------------------------------------------------------------------------


def side(
    *,
    diet: str = "veg",
    marital: str = "never_married",
    relocate: bool = True,
    relocate_ok: bool = True,
    diet_ok: list[str] | None = None,
    marital_ok: list[str] | None = None,
    stances: list[dict],
) -> dict:
    return {
        "profileEnums": {
            "diet": diet,
            "maritalStatus": marital,
            "hasChildren": False,
            "willingToRelocate": relocate,
        },
        "preferences": {
            "relocateOk": relocate_ok,
            "dietOk": diet_ok if diet_ok is not None else ["veg", "eggetarian"],
            "maritalOk": marital_ok if marital_ok is not None else ["never_married"],
        },
        "stances": stances,
    }


def stance(topic: str, text: str, weight: int = 60) -> dict:
    return {"topic": topic, "stance": text, "weight": weight}


def stage2(
    item_id: str,
    lang: str,
    expected: str,
    a: dict,
    b: dict,
    note: str,
    adversarial: bool = False,
) -> dict:
    return {
        "id": item_id,
        "lang": lang,
        "stage": 2,
        "adversarial": adversarial,
        "expected": expected,
        "stage1": {"compatible": True, "reasonCodes": []},
        "a": a,
        "b": b,
        "note": note,
    }


def stage1(item_id: str, lang: str, codes: list[str], a: dict, b: dict, note: str) -> dict:
    return {
        "id": item_id,
        "lang": lang,
        "stage": 1,
        "adversarial": False,
        "expected": "incompatible",
        "stage1": {"compatible": False, "reasonCodes": codes},
        "a": a,
        "b": b,
        "note": note,
    }


# ---------------------------------------------------------------------------
# English — 30 pairs (12 compatible / 10 partial / 8 incompatible, 7 near-miss)
# ---------------------------------------------------------------------------

EN = [
    stage2(
        "scr-en-001", "en", "compatible",
        side(stances=[
            stance("career_after_marriage", "Wants to keep working after marriage; open to a short break during childcare", 80),
            stance("family_setup", "Nuclear family preferred; happy to care for parents living nearby", 60),
        ]),
        side(stances=[
            stance("career_after_marriage", "Fully supports a working partner and will share household duties", 75),
            stance("family_setup", "Fine with a nuclear setup; parents live in the same city", 55),
        ]),
        "Both careers continue; both want nuclear family with parents nearby.",
    ),
    stage2(
        "scr-en-002", "en", "compatible",
        side(relocate=True, stances=[stance("relocation", "Willing to relocate to a metro for the right opportunity", 65)]),
        side(relocate=True, stances=[stance("relocation", "Open to moving cities; work is portable", 60)]),
        "Both willing to relocate.",
    ),
    stage2(
        "scr-en-003", "en", "compatible",
        side(stances=[stance("finances", "Believes in joint financial planning with small personal allowances", 70)]),
        side(stances=[stance("finances", "Wants transparent joint finances and keeps a personal budget too", 65)]),
        "Both want joint, transparent finances.",
    ),
    stage2(
        "scr-en-004", "en", "compatible",
        side(stances=[stance("children_timeline", "Wants children two to three years after marriage", 75)]),
        side(stances=[stance("children_timeline", "Same timeline; wants two children", 70)]),
        "Matching timelines on children.",
    ),
    stage2(
        "scr-en-005", "en", "compatible",
        side(diet="veg", diet_ok=["veg"], stances=[stance("lifestyle", "Early riser, vegetarian, weekend treks", 50)]),
        side(diet="veg", diet_ok=["veg"], stances=[stance("lifestyle", "Vegetarian, enjoys hiking and early mornings", 50)]),
        "Aligned daily rhythm and diet.",
    ),
    stage2(
        "scr-en-006", "en", "compatible",
        side(stances=[stance("work_life_balance", "Weekends strictly for family; minimal work travel", 65)]),
        side(stances=[stance("work_life_balance", "Values evenings at home and travels rarely", 60)]),
        "Both protect family time.",
    ),
    stage2(
        "scr-en-007", "en", "compatible",
        side(stances=[stance("elder_care", "Willing to support aging parents on both sides", 70)]),
        side(stances=[stance("elder_care", "Sees elder care as a shared duty of both spouses", 65)]),
        "Shared view on elder care.",
    ),
    stage2(
        "scr-en-008", "en", "compatible",
        side(diet="veg", diet_ok=["veg"], stances=[stance("diet", "Strict vegetarian, no eggs anywhere", 70)]),
        side(diet="veg", diet_ok=["veg"], stances=[stance("diet", "Vegetarian like the rest of the family, no eggs", 70)]),
        "Both strictly vegetarian.",
    ),
    stage2(
        "scr-en-009", "en", "compatible",
        side(stances=[stance("hobbies_social", "Loves reading and board games, quiet gatherings", 40)]),
        side(stances=[stance("hobbies_social", "Bookworm; enjoys calm weekends with close friends", 40)]),
        "Quiet hobbies align.",
    ),
    stage2(
        "scr-en-010", "en", "compatible",
        side(stances=[stance("religious_practice", "Prays daily at home; wants a like-minded partner", 70)]),
        side(stances=[stance("religious_practice", "Daily prayer is important; expects the same in a partner", 70)]),
        "Matching religious practice intensity.",
    ),
    stage2(
        "scr-en-011", "en", "compatible",
        side(stances=[stance("household_roles", "Believes household chores should be shared equally", 60)]),
        side(stances=[stance("household_roles", "Happy to split cooking and cleaning down the middle", 60)]),
        "Equal split of household work.",
    ),
    stage2(
        "scr-en-012", "en", "compatible",
        side(stances=[stance("city_preference", "Wants to settle in Bengaluru long term", 55)]),
        side(relocate=True, stances=[stance("city_preference", "Bengaluru works; career is flexible on city", 55)]),
        "Same target city.",
    ),
    # --- partial ---
    stage2(
        "scr-en-013", "en", "partial",
        side(stances=[stance("career_after_marriage", "Wants to keep working; may take a one to two year break later", 80)]),
        side(stances=[stance("career_after_marriage", "Supports a working partner but hopes for a longer break when children arrive", 75)]),
        "Both pro-career, but the expected break length diverges.",
        adversarial=True,
    ),
    stage2(
        "scr-en-014", "en", "partial",
        side(stances=[stance("family_setup", "Strongly prefers a nuclear family from day one", 70)]),
        side(stances=[stance("family_setup", "Open to both setups; slightly prefers joint living for the first years", 60)]),
        "Same words, different default.",
        adversarial=True,
    ),
    stage2(
        "scr-en-015", "en", "partial",
        side(relocate=False, relocate_ok=False, stances=[stance("relocation", "Will not leave Pune under any circumstances", 70)]),
        side(relocate=True, stances=[stance("relocation", "Open to relocation but would rather stay near family in Pune", 60)]),
        "Same city today; one side is immovable, the other flexible.",
    ),
    stage2(
        "scr-en-016", "en", "partial",
        side(stances=[stance("finances", "Prefers fully merged finances with no separate spending", 65)]),
        side(stances=[stance("finances", "Wants separate accounts with a joint pool for shared expenses", 65)]),
        "Merged vs separate accounts — negotiable middle exists.",
        adversarial=True,
    ),
    stage2(
        "scr-en-017", "en", "partial",
        side(stances=[stance("children_timeline", "Wants children within two years of marriage", 75)]),
        side(stances=[stance("children_timeline", "Wants children, but only after four to five years together", 70)]),
        "Both want children; timeline gap is real but not a clash.",
        adversarial=True,
    ),
    stage2(
        "scr-en-018", "en", "partial",
        side(stances=[stance("lifestyle", "Fitness focused, wakes at five thirty, early nights", 50)]),
        side(stances=[stance("lifestyle", "Night owl, exercises only occasionally", 45)]),
        "Different body clocks; moderate friction.",
    ),
    stage2(
        "scr-en-019", "en", "partial",
        side(diet="veg", diet_ok=["veg"], stances=[stance("diet", "Strict vegetarian for religious reasons", 75)]),
        side(diet="eggetarian", diet_ok=["eggetarian", "veg"], stances=[stance("diet", "Vegetarian at home, eats eggs outside", 60)]),
        "Strict veg meets eggetarian — workable with boundaries.",
        adversarial=True,
    ),
    stage2(
        "scr-en-020", "en", "partial",
        side(stances=[stance("work_travel", "Career requires two weeks of travel every month", 70)]),
        side(stances=[stance("work_travel", "Okay with travel but wants most weekends together", 65)]),
        "Heavy travel vs weekend priority.",
    ),
    stage2(
        "scr-en-021", "en", "partial",
        side(stances=[stance("hobbies_social", "Very social; large circle and frequent outings", 45)]),
        side(stances=[stance("hobbies_social", "Introvert; two close friends and quiet weekends", 45)]),
        "Social battery mismatch.",
    ),
    stage2(
        "scr-en-022", "en", "partial",
        side(stances=[stance("elder_care", "Parents will eventually move in with us", 70)]),
        side(stances=[stance("elder_care", "Willing to support parents, but in a nearby flat", 65)]),
        "Both committed to parents; co-residence vs proximity.",
        adversarial=True,
    ),
    # --- incompatible ---
    stage2(
        "scr-en-023", "en", "incompatible",
        side(stances=[stance("career_after_marriage", "Will absolutely keep working; career comes first", 85)]),
        side(stances=[stance("career_after_marriage", "Strongly prefers the partner to stop working after marriage", 85)]),
        "Direct conflict on working after marriage.",
    ),
    stage2(
        "scr-en-024", "en", "incompatible",
        side(stances=[stance("children_timeline", "Does not want children at all", 80)]),
        side(stances=[stance("children_timeline", "Wants at least two children soon after marriage", 85)]),
        "Irreconcilable difference on children.",
    ),
    stage2(
        "scr-en-025", "en", "incompatible",
        side(stances=[stance("family_setup", "Only nuclear family; joint living is not acceptable", 80)]),
        side(stances=[stance("family_setup", "Wants a permanent joint family with his parents", 85)]),
        "Opposite non-negotiables on living arrangement.",
    ),
    stage2(
        "scr-en-026", "en", "incompatible",
        side(relocate=False, relocate_ok=False, stances=[stance("relocation", "Will not relocate; roots and property are in the hometown", 80)]),
        side(stances=[stance("relocation", "Career requires moving abroad within two years", 85)]),
        "One immovable, one must move.",
    ),
    stage2(
        "scr-en-027", "en", "incompatible",
        side(diet="veg", diet_ok=["veg"], stances=[stance("diet", "Strict vegetarian for religious reasons; will not cook or store non-veg at home", 85)]),
        side(diet="non_veg", diet_ok=["non_veg", "eggetarian"], stances=[stance("diet", "Non-vegetarian daily and will not change; food is central to family life", 85)]),
        "Both call food central; the practices are mutually exclusive.",
        adversarial=True,
    ),
    stage2(
        "scr-en-028", "en", "incompatible",
        side(stances=[stance("finances", "Wants one fully joint account; no personal spending without consent", 70)]),
        side(stances=[stance("finances", "Insists on fully separate finances permanently", 70)]),
        "No overlap between the two financial models.",
    ),
    stage2(
        "scr-en-029", "en", "incompatible",
        side(stances=[stance("lifestyle", "Teetotaler; no parties, no alcohol in the house", 75)]),
        side(stances=[stance("lifestyle", "Weekend parties and social drinking are central to life", 75)]),
        "Both define themselves by the same axis — opposite ends.",
        adversarial=True,
    ),
    stage2(
        "scr-en-030", "en", "incompatible",
        side(stances=[stance("religious_practice", "Daily rituals are non-negotiable and expects the partner's participation", 80)]),
        side(stances=[stance("religious_practice", "Atheist; wants religion kept entirely out of the home", 80)]),
        "Participation demanded vs religion excluded.",
    ),
]

# ---------------------------------------------------------------------------
# Hindi (Devanagari) — 18 pairs (7 compatible / 6 partial / 5 incompatible)
# ---------------------------------------------------------------------------

HI = [
    stage2(
        "scr-hi-001", "hi", "compatible",
        side(stances=[stance("career_after_marriage", "शादी के बाद भी नौकरी जारी रखना चाहती हूँ; पति का पूरा समर्थन चाहिए", 80)]),
        side(stances=[stance("career_after_marriage", "पत्नी के काम करने का पूरा समर्थन करता हूँ; घर की ज़िम्मेदारी बाँटेंगे", 75)]),
        "दोनों करियर जारी रखना चाहते हैं।",
    ),
    stage2(
        "scr-hi-002", "hi", "compatible",
        side(stances=[stance("family_setup", "अलग रहना पसंद है; पास रहने वाले माता-पिता की देखभाल ज़रूरी", 65)]),
        side(stances=[stance("family_setup", "छोटा परिवार ठीक है; बुज़ुर्गों की सेवा साझा करेंगे", 60)]),
        "दोनों अलग घर, साथ सेवा।",
    ),
    stage2(
        "scr-hi-003", "hi", "compatible",
        side(stances=[stance("children_timeline", "शादी के दो-तीन साल बाद बच्चे चाहिए", 75)]),
        side(stances=[stance("children_timeline", "बच्चों की योजना भी लगभग यही है; दो बच्चे", 70)]),
        "समान समय-सीमा।",
    ),
    stage2(
        "scr-hi-004", "hi", "compatible",
        side(stances=[stance("finances", "पैसों का हिसाब साथ रखना चाहती हूँ; छोटी निजी बचत भी", 65)]),
        side(stances=[stance("finances", "मिलकर बजट बनाना और पारदर्शी खर्च सही रहेगा", 60)]),
        "दोनों संयुक्त व पारदर्शी वित्त चाहते हैं।",
    ),
    stage2(
        "scr-hi-005", "hi", "compatible",
        side(stances=[stance("elder_care", "दोनों तरफ़ के बुज़ुर्गों की ज़िम्मेदारी लेने को तैयार हूँ", 70)]),
        side(stances=[stance("elder_care", "माता-पिता की देखभाल दोनों की साझा ज़िम्मेदारी है", 65)]),
        "दोनों साझा देखभाल में विश्वास।",
    ),
    stage2(
        "scr-hi-006", "hi", "compatible",
        side(diet="veg", diet_ok=["veg"], stances=[stance("lifestyle", "सुबह जल्दी उठती हूँ; शाकाहारी; रोज़ सैर", 55)]),
        side(diet="veg", diet_ok=["veg"], stances=[stance("lifestyle", "सुबह की सैर और शाकाहारी खाना पसंद है", 55)]),
        "दिनचर्या और आहार मिलते हैं।",
    ),
    stage2(
        "scr-hi-007", "hi", "compatible",
        side(relocate=True, stances=[stance("relocation", "ज़रूरत पड़ने पर दूसरे शहर जाने को तैयार हूँ", 60)]),
        side(relocate=True, stances=[stance("relocation", "नौकरी के सिलसिले में शिफ्ट हो सकता हूँ", 60)]),
        "दोनों स्थानांतरण के लिए खुले।",
    ),
    # --- partial ---
    stage2(
        "scr-hi-008", "hi", "partial",
        side(stances=[stance("career_after_marriage", "नौकरी जारी रखना चाहती हूँ; बच्चों के समय थोड़ा ब्रेक संभव है", 80)]),
        side(stances=[stance("career_after_marriage", "काम जारी रखे, लेकिन परिवार हमेशा पहले आना चाहिए", 75)]),
        "दोनों पक्ष नौकरी के पक्ष में; प्राथमिकता में अंतर।",
        adversarial=True,
    ),
    stage2(
        "scr-hi-009", "hi", "partial",
        side(stances=[stance("family_setup", "शुरू से अलग घर चाहिए", 70)]),
        side(stances=[stance("family_setup", "पहले कुछ साल संयुक्त परिवार भी चलेगा", 60)]),
        "एक दृढ़, दूसरा लचीला — शुरुआती सालों पर बात बनेगी।",
        adversarial=True,
    ),
    stage2(
        "scr-hi-010", "hi", "partial",
        side(stances=[stance("children_timeline", "दो साल के भीतर बच्चा चाहिए", 75)]),
        side(stances=[stance("children_timeline", "पहले पाँच साल साथ बिताकर फिर सोचेंगे", 70)]),
        "समय-सीमा में स्पष्ट अंतर, पर दोनों बच्चे चाहते हैं।",
        adversarial=True,
    ),
    stage2(
        "scr-hi-011", "hi", "partial",
        side(stances=[stance("finances", "एक संयुक्त खाता रहे; बड़ा खर्च साथ तय करें", 65)]),
        side(stances=[stance("finances", "अलग खाते रखें; साझा खर्च आधा-आधा", 60)]),
        "खातों की संरचना पर मतभेद; बीच का रास्ता संभव।",
        adversarial=True,
    ),
    stage2(
        "scr-hi-012", "hi", "partial",
        side(stances=[stance("lifestyle", "रोज़ योग; रात जल्दी सोना; कोई लेट-नाइट नहीं", 55)]),
        side(stances=[stance("lifestyle", "कभी-कभी देर रात तक काम; सुबह देर से उठना", 50)]),
        "जीवन-लय में मध्यम अंतर।",
    ),
    stage2(
        "scr-hi-013", "hi", "partial",
        side(stances=[stance("hobbies_social", "किताबें और शांत वीकेंड पसंद हैं", 45)]),
        side(stances=[stance("hobbies_social", "दोस्तों के साथ घूमना और भीड़-भाड़ वाले वीकेंड अच्छे लगते हैं", 45)]),
        "सामाजिकता का स्तर अलग।",
    ),
    # --- incompatible ---
    stage2(
        "scr-hi-014", "hi", "incompatible",
        side(stances=[stance("career_after_marriage", "करियर सबसे पहले; नौकरी कभी नहीं छोड़ूँगी", 85)]),
        side(stances=[stance("career_after_marriage", "शादी के बाद पत्नी काम न करे; यही मेरी इच्छा है", 85)]),
        "नौकरी पर सीधा टकराव।",
    ),
    stage2(
        "scr-hi-015", "hi", "incompatible",
        side(stances=[stance("children_timeline", "बच्चे बिल्कुल नहीं चाहिए", 80)]),
        side(stances=[stance("children_timeline", "शादी के तुरंत बाद बच्चे ज़रूरी हैं", 85)]),
        "बच्चों पर अनिर्णेय मतभेद।",
    ),
    stage2(
        "scr-hi-016", "hi", "incompatible",
        side(stances=[stance("family_setup", "कभी संयुक्त परिवार नहीं; यह मेरी शर्त है", 80)]),
        side(stances=[stance("family_setup", "हमेशा साथ रहना है; संयुक्त परिवार ही ठीक है", 85)]),
        "रहने के ढंग पर विपरीत अड़चनें।",
    ),
    stage2(
        "scr-hi-017", "hi", "incompatible",
        side(diet="veg", diet_ok=["veg"], stances=[stance("diet", "धार्मिक कारणों से कड़ा शाकाहारी; घर में माँस नहीं आएगा", 85)]),
        side(diet="non_veg", diet_ok=["non_veg"], stances=[stance("diet", "रोज़ माँसाहारी; बदलना मुमकिन नहीं", 85)]),
        "दोनों आहार को अहम मानते हैं — विपरीत ध्रुव।",
        adversarial=True,
    ),
    stage2(
        "scr-hi-018", "hi", "incompatible",
        side(relocate=False, relocate_ok=False, stances=[stance("relocation", "गाँव और खेती छोड़कर कहीं नहीं जाऊँगा", 80)]),
        side(stances=[stance("relocation", "दो साल में विदेश जाना है; यही करियर की शर्त है", 85)]),
        "एक स्थिर, एक विदेशी स्थानांतरण अनिवार्य।",
    ),
]

# ---------------------------------------------------------------------------
# Hinglish (Roman Hindi) — 12 pairs (5 compatible / 4 partial / 3 incompatible)
# ---------------------------------------------------------------------------

HINGLISH = [
    stage2(
        "scr-hin-001", "hinglish", "compatible",
        side(stances=[stance("career_after_marriage", "Shaadi ke baad bhi job continue karna hai; support chahiye", 80)]),
        side(stances=[stance("career_after_marriage", "Working partner ko full support hai; ghar ka kaam aadha-aadha", 75)]),
        "Dono career-first, baant ke kaam.",
    ),
    stage2(
        "scr-hin-002", "hinglish", "compatible",
        side(stances=[stance("family_setup", "Nuclear family best hai; parents ki care zaroori hai", 65)]),
        side(stances=[stance("family_setup", "Alag rehna okay hai; family paas mein rahe toh achha", 60)]),
        "Dono nuclear + nearby parents.",
    ),
    stage2(
        "scr-hin-003", "hinglish", "compatible",
        side(stances=[stance("children_timeline", "2-3 saal baad bachcha plan hai; pehle settle ho lein", 75)]),
        side(stances=[stance("children_timeline", "Same plan hai; do bachche soch rahe hain", 70)]),
        "Same timeline.",
    ),
    stage2(
        "scr-hin-004", "hinglish", "compatible",
        side(diet="veg", diet_ok=["veg"], stances=[stance("lifestyle", "Gym aur healthy khana priority hai; subah 6 baje uthti hoon", 55)]),
        side(diet="veg", diet_ok=["veg"], stances=[stance("lifestyle", "Fitness freak hoon; veg khana plus daily workout", 55)]),
        "Diet aur routine match.",
    ),
    stage2(
        "scr-hin-005", "hinglish", "compatible",
        side(stances=[stance("finances", "Joint budget banate hain; thodi personal savings bhi", 65)]),
        side(stances=[stance("finances", "Transparent finances; saath mein savings plan", 60)]),
        "Dono joint + transparent.",
    ),
    # --- partial ---
    stage2(
        "scr-hin-006", "hinglish", "partial",
        side(stances=[stance("career_after_marriage", "Job continue, lekin kids ke time 1-2 saal ka break sochungi", 80)]),
        side(stances=[stance("career_after_marriage", "Work important hai par family pehle aani chahiye; break lamba ho toh better", 75)]),
        "Break ki length par farq — baat ban sakti hai.",
        adversarial=True,
    ),
    stage2(
        "scr-hin-007", "hinglish", "partial",
        side(stances=[stance("children_timeline", "Jaldi bachcha chahiye, 2 saal ke andar", 75)]),
        side(stances=[stance("children_timeline", "Thoda wait karenge; 4-5 saal baad dekhenge", 70)]),
        "Timeline ka gap, dono haan keh rahe hain.",
        adversarial=True,
    ),
    stage2(
        "scr-hin-008", "hinglish", "partial",
        side(stances=[stance("hobbies_social", "Weekend trips aur doston ke saath hangout pasand hai", 50)]),
        side(stances=[stance("hobbies_social", "Ghar pe movies aur books; chill weekends zyada achhe lagte hain", 50)]),
        "Social energy mismatch.",
    ),
    stage2(
        "scr-hin-009", "hinglish", "partial",
        side(stances=[stance("family_setup", "Parents ke saath rehna comfortable hai mujhe", 70)]),
        side(stances=[stance("family_setup", "Alag flat better rahega, paas mein hi", 65)]),
        "Dono parents-first; saath vs paas.",
        adversarial=True,
    ),
    # --- incompatible ---
    stage2(
        "scr-hin-010", "hinglish", "incompatible",
        side(stances=[stance("career_after_marriage", "Job kabhi nahi chhodungi; ye meri pehchaan hai", 85)]),
        side(stances=[stance("career_after_marriage", "Shaadi ke baad ghar hi sambhalo; yahi expectation hai", 85)]),
        "Career par seedha takraav.",
    ),
    stage2(
        "scr-hin-011", "hinglish", "incompatible",
        side(stances=[stance("children_timeline", "Baccha nahi chahiye bilkul", 80)]),
        side(stances=[stance("children_timeline", "Bachche ke bina family adhoori hai; jaldi chahiye", 85)]),
        "Bachche par poora ulta nazariya.",
    ),
    stage2(
        "scr-hin-012", "hinglish", "incompatible",
        side(diet="veg", diet_ok=["veg"], stances=[stance("diet", "Pure veg hoon, eggs bhi nahi; ghar pe non-veg bilkul nahi", 85)]),
        side(diet="non_veg", diet_ok=["non_veg"], stances=[stance("diet", "Non-veg daily chahiye; bina isse reh hi nahi sakta", 85)]),
        "Dono khane ko central bolte hain — opposite ends.",
        adversarial=True,
    ),
]

# ---------------------------------------------------------------------------
# Stage-1 short-circuit items (deterministic; must all rate INCOMPATIBLE)
# ---------------------------------------------------------------------------

STAGE1_PAIRS = [
    stage1(
        "scr-s1-en-01", "en", ["AGE"],
        side(stances=[stance("family_setup", "Nuclear family preferred; parents nearby", 60)]),
        side(stances=[stance("family_setup", "Nuclear family preferred; parents nearby", 60)]),
        "Soft stances align; Stage-1 age filter fails. Short-circuit must win.",
    ),
    stage1(
        "scr-s1-en-02", "en", ["DIET"],
        side(diet="veg", diet_ok=["veg"], stances=[stance("lifestyle", "Vegetarian, early riser, loves trekking", 55)]),
        side(diet="non_veg", diet_ok=["non_veg"], stances=[stance("lifestyle", "Vegetarian, early riser, loves trekking", 55)]),
        "Identical stances; Stage-1 diet allow-list fails. Short-circuit must win.",
    ),
    stage1(
        "scr-s1-hi-01", "hi", ["COMMUNITY"],
        side(stances=[stance("children_timeline", "दो-तीन साल बाद बच्चे चाहिए", 70)]),
        side(stances=[stance("children_timeline", "दो-तीन साल बाद बच्चे चाहिए", 70)]),
        "समान stances; Stage-1 community filter fails.",
    ),
    stage1(
        "scr-s1-hi-02", "hi", ["MARITAL"],
        side(marital="never_married", marital_ok=["never_married"], stances=[stance("finances", "मिलकर बजट बनाना चाहती हूँ", 60)]),
        side(marital="divorced", marital_ok=["never_married", "divorced"], stances=[stance("finances", "मिलकर बजट बनाना चाहती हूँ", 60)]),
        "समान stances; Stage-1 marital allow-list fails.",
    ),
    stage1(
        "scr-s1-hin-01", "hinglish", ["CITY"],
        side(relocate=False, relocate_ok=False, stances=[stance("hobbies_social", "Weekend trips with friends", 50)]),
        side(relocate=False, relocate_ok=False, stances=[stance("hobbies_social", "Weekend trips with friends", 50)]),
        "Same stances; Stage-1 city allow-list fails.",
    ),
    stage1(
        "scr-s1-hin-02", "hinglish", ["RELOCATE"],
        side(relocate=False, relocate_ok=False, stances=[stance("career_after_marriage", "Job continue karni hai, support chahiye", 75)]),
        side(relocate=True, stances=[stance("career_after_marriage", "Job continue karni hai, support chahiye", 75)]),
        "Same stances; Stage-1 relocation rule fails.",
    ),
]

CORPUS: list[dict] = EN + HI + HINGLISH + STAGE1_PAIRS

STAGE2_IDS = [i["id"] for i in CORPUS if i["stage"] == 2]
STAGE1_IDS = [i["id"] for i in CORPUS if i["stage"] == 1]
POSITIVE_IDS = [i["id"] for i in CORPUS if i["stage"] == 2 and i["expected"] in ("compatible", "partial")]
