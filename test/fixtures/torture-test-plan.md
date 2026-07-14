# The Great Migration: rewriting `billing-service` in Rust, with a side of 🔥 emoji and "curly quotes" — a plan nobody asked for

This is intro prose sitting **before any `##` heading** — it should land in an
implicit "Overview" section rather than being dropped. It has *italics*, **bold**,
***bold italics***, ~~strikethrough~~, `inline code`, a [link](https://example.com/path?query=1&other=2),
and a footnote-style aside (not real footnote syntax, just parens). It also has an
unescaped-looking sequence that must never execute: <script>alert(1)</script> and
a stray unclosed tag: <div class="whoops"> — both should render as inert text,
never as real HTML, since gigaplan disables raw HTML in markdown-it.

Here's a wall of text to check line-length and readability at a stretch: Lorem
ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt
ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation
ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in
reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt
mollit anim id est laborum, and then some more just to make sure this paragraph
is long enough to actually wrap several times inside the content column.

## 01 · Nested lists (the recursive-splitting edge case)

gigaplan only splits list items one level deep — a sub-list nested inside an
item should still render (as part of that item's own content), just not be
individually commentable itself. Testing that it doesn't break anything:

1. Set up the new Rust workspace
   - `cargo new billing-service --lib`
   - Pin the toolchain via `rust-toolchain.toml`
   - Sub-item with **bold** and a [link](https://example.com)
2. Port the ledger module
   1. Extract the interest-calculation logic first
   2. Then the reconciliation job
      - which itself has a nested nested bullet
      - two levels deep now
   3. Leave the tax module for phase 2
3. Stand up parallel-run infrastructure

## 02 · Checklists interleaved with prose

- [x] Provision the staging cluster
- [x] Mirror production traffic at 1%
- [ ] Get sign-off from the payments team
- [ ] Cut over DNS

A paragraph interrupting the checklist flow, to make sure section grouping
doesn't get confused by alternating block types.

- [ ] Final checklist item after the interruption, checkbox unchecked
- [X] Uppercase X variant (also valid GFM) should still count as checked

## (this section heading is intentionally empty — no content before the next one)

## 03 · Ordered list starting at an unusual number

5. Item five (list starts at 5, not 1 — `ordinal` tracking should reflect that)
6. Item six
7. Item seven

## 04 · Consecutive lists of different kinds back-to-back

- bullet one
- bullet two

1. ordered one
2. ordered two

- bullet again, a *third*, unrelated list right after an ordered one

## 05 · Code fences torture test

A completely empty fence:

```

```

A fence with no language tag and a very long single line that should scroll
horizontally instead of wrapping or breaking the layout:

```
const reallyLongVariableNameThatGoesOnForeverAndEverAndNeverStops = computeSomethingExpensive(withA, lotOf, arguments, thatMake, thisLine, absurdly, long, onPurpose, toTestHorizontalScrollBehaviorInsideThePreElementWithoutBreakingTheSurroundingLayoutOrCausingThePageItselfToScrollSideways);
```

A fence containing something that looks like markdown itself (headings, another
fence, a list) to make sure it's rendered as literal code, not parsed:

````markdown
# This is not a real heading, it's text inside a code fence
- nor is this a real list item
```
nor is this a real nested fence
```
````

A fence containing raw HTML/script-looking content, to check the JSON-island
escaping in `render.ts` (a literal `</script>` inside fenced code must not be
able to break out of the embedded JSON island):

```html
<script>document.title = "pwned"</script>
<style>body { display: none }</style>
```

A fence with a language tag that has unusual characters:

```jsx
export const Widget = () => <div className="a && b">{'</script>'}</div>;
```

A fence in a language `highlight.js` recognizes, with a mix of token kinds
(keyword, string, comment, number) to check syntax highlighting:

```python
# a comment
def greet(name):
    count = 3
    return f"hello {name}" * count
```

## 06 · Tables torture test

A wide table with many columns:

| id | service | owner | region | status | rps | p50 | p99 | error rate | on-call |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | billing-service | @alice | us-east-1 | green | 1200 | 12ms | 88ms | 0.01% | alice |
| 2 | ledger-service | @bob | us-west-2 | yellow | 340 | 20ms | 410ms | 1.2% | bob |
| 3 | tax-service | @carol | eu-west-1 | red | 15 | 5ms | 2100ms | 8.9% | carol |

A table with long cell content and an escaped pipe character:

| Field | Description |
| --- | --- |
| `amount_cents` | The transaction amount in integer cents (never floats — see the ADR at `docs/adr/0007-no-floats-for-money.md` for the full rationale, including the 1998 incident) |
| `currency` | ISO 4217 code; a literal pipe inside a cell must render correctly: `a \| b` |
| `metadata` | Arbitrary JSON blob, e.g. `{"source": "api", "retries": 3}` |

## 07 · Blockquotes and rules

> A blockquote with **formatting** inside it, and a nested blockquote:
>
> > This is a nested blockquote, one level deeper.
> > It should still render distinctly from the outer one.
>
> Back to the outer quote level.

---

Text between two rules.

---

## 08 · Unicode, emoji, and things that break naive string slicing

Emoji: 🚀 🔥 ✅ ❌ 🧵 👀. Non-Latin scripts: 日本語のテキスト, Ελληνικά, العربية, עברית.
Combining characters: é (e + combining acute) vs é (precomposed). Curly quotes:
"like this" and 'like this'. An em dash — like this — and an ellipsis…
A zero-width joiner emoji sequence: 👨‍👩‍👧‍👦. A very long unbroken token that
should still be handled without breaking layout:
supercalifragilisticexpialidocious-but-as-one-continuous-hyphenated-token-that-keeps-going-and-going-and-going.

### 08a · A subheading (h3) nested inside a `##` section

This paragraph lives under an `h3`, not a `##` — it should render as an item
within section 08, not start a new numbered section of its own.

#### 08a-i · And an h4 for good measure

Even deeper nesting of headings, still not a new top-level section.

## 09 · A long section with many items, to check scroll length and comment-count math

1. First of many
2. Second of many
3. Third of many
4. Fourth of many
5. Fifth of many
6. Sixth of many
7. Seventh of many
8. Eighth of many
9. Ninth of many
10. Tenth of many
11. Eleventh of many
12. Twelfth of many
13. Thirteenth of many
14. Fourteenth of many
15. Fifteenth and last of many

## 10 · Wrap-up

- [ ] Re-read every section above at least once
- [ ] Confirm nothing in Section 05's HTML/script fence executed
- [ ] Confirm Section 07's nested blockquote rendered distinctly
- [ ] Confirm the empty section between 02 and 03 didn't break numbering
- [ ] Approve, or leave a comment on literally anything above
