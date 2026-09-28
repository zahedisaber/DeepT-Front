from deept_agent.catalog import Catalog, parse_catalog_js


def test_parses_the_frontend_catalog():
    catalog = Catalog.load()
    assert len(catalog.items) > 200
    birth = catalog.by_id["9"]
    assert birth.label == "شناسنامه" and birth.base == 171360
    assert catalog.by_id["9-1"].addition
    assert catalog.by_id["224"].pinned
    assert catalog.by_id["12"].base_unit == "صفحه"


def test_parser_handles_comments_and_trailing_commas():
    src = '''
const PRICE_CATALOG = [
  { category: "c", items: [
    // a comment line
    { id: "1", label: "a: b", base: 10, extra: null, unit: null },
  ]},
];
'''
    [item] = parse_catalog_js(src)
    assert item.label == "a: b" and item.extra is None


def test_search_matches_spelling_variants_and_synonyms():
    catalog = Catalog.load()
    assert catalog.search("كارت ملي")[0][0].id == "14"
    assert catalog.search("پاسپورت")[0][0].label == "گذرنامه"
    assert catalog.search("گواهی عدم سوء پیشینه")[0][0].label == "گواهی عدم سوءپیشینه"
    assert catalog.search("قیمت ترجمه چی") == [] or catalog.search("قیمت ترجمه چی")[0][1] < 1
    assert not any(item.pinned for item, _ in catalog.search("پیک"))
