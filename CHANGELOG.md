# Spelling Nest, version history

The app is a single file, `app/index.html`, and its version is set once in `APP_VERSION`
and watermarked in the bottom right corner of every screen. This file is the record of
what each version changed.

Numbering: small fixes go up by 0.0.1, batches of features by 0.1.

Every entry below is taken from the commit that shipped it. Where the commit record and
the feature log in the project notes disagree, the disagreement is stated rather than
smoothed over.

## 2.9, 15 November 2026, with terms of sale version 1.1

**Terms of sale version 1.1 published** at `spellingnest.co.uk/terms.html`, approved by Stuart.
Two changes to version 1.0: it says plainly that a family subscribing again pays on the day it
subscribes, with the 14 day right and a full refund if it cancels within 14 days, and it sets out
the 14 days a family has to put right a failed payment before lessons pause and the subscription
is cancelled. Both now match what the app does (2.7 and 2.8). Everything else is unchanged.

**The app now records agreement to version 1.1** at checkout: `terms_version` sent to
`create-checkout-session`, and carried into Stripe metadata on the sale, changed from `1.0` to
`1.1`. The terms were published first, so no sale was ever recorded against a version not yet live.

## 2.8, 15 November 2026

**The subscribe wording now matches whether a free fortnight is owed.** The box a parent ticks
to agree to the terms of sale told every family their card would be charged "when the free
fortnight ends". The fortnight is offered once per family, on a first subscription, so a family
subscribing again was agreeing to a fortnight they would not get, and was then charged on the
day. They now read that, because they have subscribed before, there is no free fortnight this
time, the card is charged today, and they can still cancel within 14 days for a full refund,
which is what section 4 and the cancellation section of the terms of sale already say. The note
under the buttons says the same. The app decides who is owed the trial by exactly the rule
`create-checkout-session` uses, so the screen and the charge cannot disagree.

Unchanged on purpose: the version 2 sign up plan screen, which only a family that has never
subscribed ever sees.

21 new automated checks across a beta family after its free year, a family cancelled for non
payment, a family that cancelled and lapsed, and a never subscribed family, with the earlier
suites rerun against the same file.

## 2.7, 15 November 2026

**A countdown when a card is declined.** When a renewal fails, Grown ups now shows how many days
are left to update the card, and the date on which lessons pause and the subscription is
cancelled if no payment has been taken. On the last day it says *Last day to update your card*.
After that date it says lessons are paused until a payment goes through, still with the card
update button while the subscription can be rescued, and once Stripe has cancelled it says so
and offers to subscribe again. It is behind the PIN only; the child sees Kit resting when
lessons pause, and nothing about money.

**The timeline is Stripe's own retry window, fourteen days**, which is what makes it fee safe:
Stripe is set to Smart Retries, up to 8 attempts in 2 weeks, then cancel, and it never retries
a hard decline such as a revoked card authority until a new card is added. Eight attempts in
fourteen days is under the card networks' monthly reattempt ceiling. The grace length lives in
one constant in `sn_subscription_state()` and must be changed with the Stripe setting.

**A change of policy, recorded plainly:** a declined renewal used to keep access to the end of
a period Stripe had already advanced and nobody had paid for. Access now lasts for the grace
period, ends sooner if Stripe cancels first, and comes straight back when a payment goes through.

Server side: migration `v17_payment_grace`, which adds `families.payment_failed_at`, set by a
trigger on the first `payment_failed` event and cleared by a trigger on the next payment, and
rewrites the gate function to use it. Proved on eight cases in a rolled back transaction first.

Also in Stripe, the same day: *Send a Stripe hosted link for customers to confirm their payments
when required* switched on, with Stripe's reminders at 3, 5 and 7 days.

25 new automated checks, with the 133 from 2.3 to 2.6 rerun against the same file.

## 2.6, 15 November 2026

**A failed payment is no longer described as a cancellation.** When a renewal is declined,
Stripe marks the subscription `past_due` and keeps trying the card. The app handled that state
in the same branch as a cancellation, so a parent whose card had failed was told in Grown ups
"You have cancelled, so there is nothing more to pay", which was untrue on both counts. They now
see *Your last payment did not go through*: nothing has been taken, Stripe will try the card
again, practice carries on until the end of the period, and if no payment can be taken by then
lessons pause and nothing is deleted. One button, **Update your card**, opens the Stripe Customer
Portal. It is shown behind the Grown ups PIN only; the child's screen never mentions money.
Found by the production health check, Run 11.

**`voice_changed` now answers the question it exists for** (health check SN-033). It used to
fire on every change of the voice list, so a parent auditioning voices produced one event per
tap, and it recorded only "chosen" or "auto". It now fires once, four seconds after the parent
stops changing it, only if they ended on a different voice from the one they started with, and
records the voice's name and language from the device's own list, plus how many they tried.

**Also fixed:** the *Keep my subscription* button had carried a class with no style since it was
added, so it rendered as a bare browser button.

**Server side, the same day, no app change:** every paid invoice now records a
`payment_succeeded` event, so the event stream shows successful renewals next to
`payment_failed` (health check, Run 11). It is written by a database trigger on the `payments`
table rather than by redeploying the Stripe webhook, and it flags a trial converting
(`first_payment`) separately from a renewal, and a renewal paid after a decline
(`after_failure`). Migrations `v15_payment_succeeded_event` and `v16_payment_succeeded_trigger`.
Stripe's own failed card payment email was checked and was already switched on.

41 automated checks for this release, with the 92 from 2.3 to 2.5 re run against the same file.

## 2.5, 7 November 2026

**A practice test.** Every word on the list exactly once, in a shuffled order, all of them
through Look, cover, write, check. It sits as a quieter second button on the child's Play
screen at all times, and on the single day before the spelling test it becomes the main
button above the lesson, with the countdown already on screen explaining why.

What it deliberately does not do: no clues, no hearts, and no second go at a missed word. The
clue timers were never part of Look, cover, write, check anyway, so only the other two needed
switching off. A score that mixes words a child knew with words the app told them is not a
score, and a test that stops early because a five year old ran out of hearts measures stamina
rather than spelling. Hear it and Slowly stay, because saying the word aloud is exactly what a
teacher does in a real test.

A word spelled right first time in the test earns one of its three mastery days, on the same
rule as a lesson. That made the old wording on the Play and Progress screens untrue, since it
said mastery came "from sound alone", so both screens were reworded. The Progress screen also
now shows that definition when the word list has words in it; until this release it appeared
only when the list was empty.

No migration and no new event name: `lesson_started`, `lesson_completed` and `lesson_abandoned`
gained a `mode` property of `lesson` or `test`. The `lesson_history` table is unchanged, so the
database does not yet distinguish a test from a lesson.

The what's new note from 2.4 carries a new key, so it returns once to tell families about it.

38 automated checks for the test, with the 54 from 2.3 and 2.4 re run against the same file.

## 2.4, 3 November 2026

**A dismissible "what's new" note in the word list editor.** The app had no way of telling a
parent that anything had changed: the only version signal on screen is the watermark in the
bottom right corner, so the photo reader shipped in 2.3 would have been found by accident or
not at all. A short gold note now appears above the editor, names what is new and where the
button is, and goes away for good when the parent presses **Got it**.

The dismissal is kept in that browser (`localStorage`, key `sn_whatsnew`) and nowhere else. It
is not analytics and is sent nowhere, so it sits outside the consent gate and needed no
migration and no column grant. The cost is that a parent using a phone and a laptop sees the
note once on each. The mechanism is reusable: one entry with a key, so a new key brings the
note back for everybody at the next release, and clearing the entry shows nothing. It is
withheld from a read only family, because a parent who cannot edit a word list at all should
not be told about a better way to add words. No analytics event was added on purpose, since
`photo_read` volume before and after already answers whether the note worked.

34 automated checks, including both colour themes and a browser with site data blocked.

Commit `e7ac894`.

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
> missing from the live app for about nine minutes (`42d271c` at 15:56 UTC, `9240dca` at
> 16:05 UTC), plus however long the cache took to turn over. `9240dca` rebuilt 2.3 on the
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
