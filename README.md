# EzApply

A Chrome extension that fills repetitive Google Forms in one click.

College placement drives collect applicant data through Google Forms, and every form asks
the same things: name, mobile number, email, roll number, degree, branch, graduation year,
CGPA, skills, projects, GitHub and LinkedIn links. EzApply stores that once, locally, and
fills any Google Form from the toolbar button.

It gets better the more you use it: correct an answer and it remembers, and any question it
does not recognise can become a permanent field of your own with two clicks.

**EzApply never submits a form for you, and never sends your details anywhere.** There is no
server, no account, and no network request of any kind in the codebase.

---

## Install

No build step — the source runs as-is.

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose this folder (`D:\EzApply`)
4. The options page opens automatically — fill in your details
5. Open any Google Form and click the EzApply toolbar icon

## Use

| Colour | Meaning |
| --- | --- |
| Green | Filled with high confidence |
| Amber | Filled, but check it — the match was uncertain |
| Grey (dashed) | Skipped; the panel says why |

Click any row in the review panel to jump to that question. Then review and submit the form
yourself.

### Adding your own fields

The built-in fields cannot cover everything a college form invents — a LeetCode link, a
hostel name, a blood group, a company-specific question. Two ways to add one:

- **From the form (easiest).** Run EzApply, find the question in the panel's *Skipped* list,
  and click **+ Add this field**. The field name and type are filled in from the question
  itself; type your answer and save. It fills that question immediately and every similar
  question from then on.
- **Ahead of time.** Options page → **My Fields** → **+ Add field**.

Either way the field becomes a first-class part of matching. A field called *LeetCode Profile
Link* will also answer a form that asks "Your LeetCode profile" — synonyms are derived from
the name automatically, and you can add more under "Also matches".

### How it learns

Correct an answer by hand and EzApply reacts based on what you typed:

- The value already exists elsewhere in your profile → it remembers *this question means that
  field*, so the next form phrased differently still gets it right.
- The value is new but the question was one it understood → it offers to **update** that
  field, rather than creating a near-duplicate that would compete with it later.
- The question was unknown → it offers to save the answer as a new field.

Everything it has learned is listed in the options page under **What EzApply has learned**,
with a *Forget* button per row.

## What it cannot do

- **File uploads.** Google's file question opens a Drive picker that no extension can drive.
  These are always reported as skipped — attach the file yourself.
- **Grid questions.** Reported as skipped rather than filled incorrectly.
- **Submit the form.** By design.

## Backup

Your details live in `chrome.storage.local`, in this browser profile on this computer only.
Options page → **Backup** → **Export JSON** before reinstalling Chrome or moving machines.

---

## Development

```bash
npm test
```

29 tests covering normalization and matching, with no dependencies (`node --test`). The
matcher and normalizer are pure functions with no DOM or `chrome.*` access, which is what
makes them testable in Node at all.

### Testing without Google

Open `tests/fixtures/mock-form.html` directly in a browser. It reproduces the ARIA structure
of a real Google Form — including a dropdown whose options only render after the first click
— stubs `chrome.storage`, and seeds a sample profile. Click **Run EzApply**.

### Layout

```
manifest.json              MV3 manifest
src/common/                pure logic, shared by every surface, unit-tested
  schema.js                profile shape + buildFieldRegistry(profile)
  normalize.js             label cleanup, abbreviations, similarity
  matcher.js               scoring and confidence bands
  storage.js               chrome.storage.local wrapper + migration
src/content/               everything that touches the Google Forms page
  gforms-selectors.js      every selector, isolated — see below
  gforms-parser.js         DOM  -> Question[]
  gforms-filler.js         value -> DOM, one strategy per widget type
  panel.js                 review panel and the add-field form
  learner.js               correction capture
  content.js               orchestrator
src/popup/, src/options/   extension UI
tests/                     node --test suites + the mock form fixture
docs/SRS.md                software requirements specification
```

The options page's profile editor is **generated from the same field registry the matcher
uses**, so adding a field to `src/common/schema.js` makes it appear in the UI automatically;
the two can never drift apart.

### When Google changes their DOM

Google's CSS class names are obfuscated and rotate without notice (`.whsOnd`, `.Qr7Oae`,
`.M7eMe`…). Every selector in EzApply is therefore role- and attribute-first — `[role="listitem"]`,
`[role="radio"]`, `[role="listbox"]` — because ARIA roles are part of Google's accessibility
contract and change far less often. Class names appear only as a labelled last-resort fallback.

If EzApply suddenly stops recognising questions, **`src/content/gforms-selectors.js` is almost
certainly the only file that needs changing.** Open a form, inspect the question container, and
update the relevant selector list there. Nothing else in the codebase queries the page.

### One non-obvious implementation detail

Google Forms is a Closure app: at submit time it reads its own internal model, not
`input.value`. Setting `input.value = x` therefore *looks* correct on screen and submits an
empty answer. Every text write in `gforms-filler.js` goes through the native prototype value
setter and is followed by bubbling `input` and `change` events plus a real blur. If you change
that code, verify by actually submitting a form and checking the recorded response — not by
looking at the page.

## License

MIT
