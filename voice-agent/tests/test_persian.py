import pytest

from deept_agent.persian import normalize, number_to_words, to_speakable, toman_words


@pytest.mark.parametrize("n, words", [
    (0, "صفر"),
    (7, "هفت"),
    (15, "پانزده"),
    (20, "بیست"),
    (21, "بیست و یک"),
    (105, "صد و پنج"),
    (1000, "هزار"),
    (2000, "دو هزار"),
    (171360, "صد و هفتاد و یک هزار و سیصد و شصت"),
    (1250000, "یک میلیون و دویست و پنجاه هزار"),
    (3000400, "سه میلیون و چهارصد"),
])
def test_number_to_words(n, words):
    assert number_to_words(n) == words


def test_toman_words():
    assert toman_words(60000) == "شصت هزار تومان"


def test_normalize_folds_arabic_letters_digits_and_zwnj():
    assert normalize("كارت ملي") == normalize("کارت‌ملی".replace("‌", " ")) == "کارت ملی"
    assert normalize("کد ۱۲۳") == "کد 123"


def test_to_speakable_reads_amounts_as_words_and_codes_digit_by_digit():
    assert to_speakable("قیمت 171,360 تومان") == "قیمت صد و هفتاد و یک هزار و سیصد و شصت تومان"
    assert to_speakable("۳ صفحه") == "سه صفحه"
    assert to_speakable("شماره 0912") == "شماره صفر نه یک دو"
    assert to_speakable("کد 40213") == "کد چهل هزار و دویست و سیزده"
    assert to_speakable("کد 12345678") == "کد یک دو سه چهار پنج شش هفت هشت"
