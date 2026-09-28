"""Persian text helpers: normalization for search, and number -> words for speech.

TTS voices read raw digits badly ("171360" comes out as a digit string or in
English), so every number the agent speaks goes through to_speakable() first.
"""

import re

_ARABIC_TO_PERSIAN = str.maketrans({"ي": "ی", "ك": "ک", "ى": "ی", "ة": "ه", "ۀ": "ه", "أ": "ا", "إ": "ا", "آ": "ا"})
_DIGITS_TO_ASCII = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_ASCII_TO_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
_DIACRITICS = re.compile("[ً-ْٰ]")
_PUNCT = re.compile(r"[()\[\]{}،,؛;:.!?؟«»\"'/\\\-_+*]")

_ONES = ["صفر", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"]
_TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"]
_TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"]
_HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"]
_SCALES = ["", "هزار", "میلیون", "میلیارد", "تریلیون"]


def normalize(text: str) -> str:
    """Fold spelling variants so 'كارت ملي', 'کارت‌ملی' and 'کارت ملی' compare equal."""
    text = text.translate(_ARABIC_TO_PERSIAN).translate(_DIGITS_TO_ASCII)
    text = _DIACRITICS.sub("", text)
    text = text.replace("‌", " ").replace("‏", "").replace("‎", "")
    text = _PUNCT.sub(" ", text)
    return " ".join(text.lower().split())


def to_ascii_digits(text: str) -> str:
    return text.translate(_DIGITS_TO_ASCII)


def to_fa_digits(text: str) -> str:
    return str(text).translate(_ASCII_TO_FA_DIGITS)


def _three_digits(n: int) -> str:
    parts = []
    h, rest = divmod(n, 100)
    if h:
        parts.append(_HUNDREDS[h])
    if 10 <= rest < 20:
        parts.append(_TEENS[rest - 10])
    else:
        t, o = divmod(rest, 10)
        if t:
            parts.append(_TENS[t])
        if o:
            parts.append(_ONES[o])
    return " و ".join(parts)


def number_to_words(n: int) -> str:
    """171360 -> 'صد و هفتاد و یک هزار و سیصد و شصت'."""
    if n == 0:
        return _ONES[0]
    if n < 0:
        return "منفی " + number_to_words(-n)
    groups = []
    scale = 0
    while n:
        n, chunk = divmod(n, 1000)
        if chunk:
            if scale == 1 and chunk == 1:
                # Persian says "هزار", not "یک هزار".
                groups.append(_SCALES[1])
            else:
                words = _three_digits(chunk)
                groups.append(f"{words} {_SCALES[scale]}".strip())
        scale += 1
    return " و ".join(reversed(groups))


def toman_words(amount: int) -> str:
    return f"{number_to_words(int(amount))} تومان"


def digits_to_words(digits: str) -> str:
    """Read a code/phone number digit by digit: '0912' -> 'صفر نه یک دو'."""
    return " ".join(_ONES[int(d)] for d in to_ascii_digits(digits) if d.isdigit())


# A number with thousands separators, or a plain run of digits.
_NUMBER = re.compile(r"\d{1,3}(?:[,٬]\d{3})+|\d+")


def to_speakable(text: str) -> str:
    """Rewrite digits in agent output into words a TTS voice reads naturally.

    Grouped numbers (171,360) and short plain numbers are amounts; long or
    zero-leading runs (09121234567, tracking codes) are read digit by digit.
    """
    text = to_ascii_digits(text)

    def repl(m: re.Match) -> str:
        raw = m.group(0)
        if "," in raw or "٬" in raw:
            return number_to_words(int(raw.replace(",", "").replace("٬", "")))
        if raw.startswith("0") and len(raw) > 1 or len(raw) >= 8:
            return digits_to_words(raw)
        return number_to_words(int(raw))

    return _NUMBER.sub(repl, text)
