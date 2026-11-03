# Spelling Nest, version history

The app is a single file, `app/index.html`, and its version is set once in `APP_VERSION`
and watermarked in the bottom right corner of every screen. This file is the record of
what each version changed.

Numbering: small fixes go up by 0.0.1, batches of features by 0.1.

Every entry below is taken from the commit that shipped it. Where the commit record and
the feature log in the project notes disagree, the disagreement is stated rather than
smoothed over.

## 2.3, 3 November 2026

**Read the spelling list from a photo.** A grown up adding the week's words can point the
camera at the sheet from school and the app reads the words out of it. The reading happens
entirely on the device, with Tesseract fetched only when a parent first asks for it, so the
photo is never sent anywhere and there is no new processor to add to the privacy notice.
The image is redrawn through a canvas before it is read, which also drops the EXIF block
and with it the location the photo was taken in. Words that look like headings,
instructions, dates or a school name are discarded; up to forty words are offered for the
parent to check and edit. A `photo_read` event records the outcome, the number of words and
how long it took, and carries no image and no words.

Commits `42d271c` and `9240dca`.

> **Correction, same day.** `42d271c` was built on the 27 September copy of the file rather
> than the current one, which reverted the two commits of 28 October below. They were
> missing from the live app for about twenty five minutes. `9240dca` rebuilt 2.3 on the
> correct base and restored both. The lesson, now a step in the deployment notes: fetch the
> live file as the base for every build, never a local copy.

## 28 October 2026, no version change

- **Head tags on the app**: page title, description, canonical address, Open Graph and
  Twitter cards, and a `WebApplication` schema. Commit `5d92643`.
- **App analytics mirrored to HeyCatch**, gated on the parental consent already on record.
  Nothing is captured and nothing is written to browser storage until consent is given;
  autocapture is off, so no click or form submission can carry a word list or a child's
  nickname; captured elements carry no text and no attributes; Do Not Track is honoured.
  The identity is the Supabase user id, never an email address. Commit `3feb1f8`.

## 2.2, 27 September 2026

**Version 2 live.** A new first run that takes a family from signing up to a usable lesson,
with the words from a school spelling sheet carried across into it. Commit `e148500`.

## 1.17, 27 September 2026

**Email and password sign in**, with a code bridge for existing families. A family who has
only ever used the six digit code signs in with the code once more and is then invited to
set a password. Password reset is by six digit code rather than a link, for the same reason
as 1.3: a one time link is consumed by email prefetchers and link scanners before the
parent taps it. Commit `4fb41f0`.

## 1.16, 26 September 2026

**Voice chooser in the Grown ups settings.** A parent can pick which of the device's own
voices Kit uses, so a family whose default voice is hard to follow can change it without
changing a system setting. Commit `809c0fe`.

## 1.15, 22 September 2026

**Words taken in from a school spelling sheet QR code.** A parent scans the code on a sheet
built at `spellingnest.co.uk/teachers/` and the words appear in the app, behind the Grown
ups PIN and never added without a grown up confirming. Commit `0b168a5`. Database change
v10 added the `sheet_scanned` event and was applied before the app shipped.

## 1.14, 22 September 2026

Plan screen shown straight after setup, and the version watermark added. Commit `e807950`.

## 1.13, 21 September 2026

New sounds for right and wrong answers. Commit `4baea12`.

## 1.12, 21 September 2026

An unfinished answer can be checked. Commit `2c8caba`.

## 1.11, 20 September 2026

Undo and Clear moved clear of the letter tiles. Commit `e25276c`.

## 1.10, 20 September 2026

Long words stay on one line, a Clear button, and a cancelled subscription can be resumed.
Commit `149665c`.

## 1.8, 19 September 2026

- **A cancelled subscription is no longer described as renewing.** Stripe leaves a cancelled
  subscription's status as `trialing` until the period actually ends, so the app went on
  telling parents a payment was due after they had cancelled. Fixed through the webhook, the
  gate function and the app.
- **Six accessibility defects fixed** after a WCAG 2.2 AA audit: the keyboard focus ring,
  the tab bar covering a focused control, a date field with no focus indicator, a chip below
  contrast, `aria-label` on sixteen elements not permitted to carry it, and an unnamed
  progress bar. Conformance is **not** claimed: there has been no screen reader pass, no real
  device check of the code autofill, and no testing with disabled users.
- **Complete account deletion.** Deleting a family now removes the `auth.users` row as well,
  through a server side function, so a parent's email address and a child's usage history do
  not survive a deletion. A live subscription is cancelled first.
- **Two analytics events that were going nowhere**: `checkout_started` had been rejected by
  the database on every checkout since 1.2, and `grownups_opened` had never fired once. Both
  fixed, with a test that asserts every event name the app can emit is one the database
  permits.

Commit `6312f77`.

## 1.7, 18 September 2026

**Card up front and a fourteen day Stripe trial**, replacing the five day trial with no card.
The trial clock moved out of the database into Stripe. Fourteen days aligns the trial with
the statutory cancellation right under the Consumer Contracts Regulations 2013. Terms of sale
agreed at checkout, with the version and timestamp carried into Stripe as metadata on both
the Checkout Session and the subscription. Commit `44781d5`.

## 1.5, 18 September 2026

- **The word cleaner keeps apostrophes.** It had been stripping them, so a parent typing
  *they're* got *theyre* and the app then taught the wrong spelling and marked the right one
  wrong. Straight and curly apostrophes are normalised to one form, kept inside a word, and
  stripped only at the ends or when doubled.
- **Homophones handled properly in Listen and spell.** *There*, *their* and *they're* sound
  identical, so the question is unanswerable: any of the three answers the sound. The question
  type is now withheld for 275 homophones and 41 near confusables, each with a disambiguating
  sentence, and mastery for those words is earned through Look, cover, write, check instead.

Commit `7c7794f`.

> **[Unverified] Numbering discrepancy.** The feature log records both of these changes
> against version 1.6, and no commit mentions 1.6 or 1.9. The commit message is the record
> used here.

## 1.4, 18 September 2026

A sign in code of any length is accepted. Commits `9a6c654` and `4c7500f`.

## 1.3, 18 September 2026

**Sign in by six digit code instead of an email link.** Each magic link token was being
fetched three to six times from different countries before the parent could use it, which is
email prefetching and link scanning; a one time link something else has already opened is
spent. A six digit code cannot be consumed by a scanner. The app had also been swallowing
`#error=access_denied` silently, so a parent saw the sign in screen again with no
explanation; that now shows a message. Commit `12078b4`.

## 1.2, 18 September 2026

**Subscription gate in the app**, and a free first year for the beta families. The gate reads
`sn_subscription_state()` server side; the trial countdown and the paywall live in Grown ups
behind the PIN and are never shown to the child. A family that is read only sees only "Kit is
having a rest", with no price, no urgency and no button aimed at the child, and their word
list stays on screen. The gate fails open: if it cannot be reached, the family keeps access,
because a database fault must never be the reason a child cannot practise. Commit `92287d9`.

## 18 September 2026, structure change

Landing page added at `spellingnest.co.uk`, the app moved to `spellingnest.co.uk/app`, and
screenshots added. Commit `7c760a9`.

---

**[Unverified] Versions 1.0 and 1.1** predate this record. They were built before the landing
page restructure above and their commits do not carry version numbers, so what each contained
is not reconstructed here. The feature log in the project notes lists F004, F005, F009, F012
and F013 as done in 1.1.
