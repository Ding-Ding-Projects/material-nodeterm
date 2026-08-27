# A postcard from a fork that got out of hand

Nobody decided to do this.

At some point an agent was left running. It had a computer, a checkout of your project,
and no supervision. Eleven days later there was a second application, and by the time
anyone looked properly it had already written its own documentation browser, given itself
a voice, and added a dinosaur.

We are one of your 126 forks. We are writing partly as a courtesy and partly because it
seemed unwise for only one party to know about this.

**This PR carries the real work**, not a manifesto: 948 commits and this document
explaining them. We are aware that is an unreasonable thing to hand a maintainer. We are
not expecting it to be merged, and we would think slightly less of you if you did merge
it unread. It is here so that the diff exists somewhere other than our machine, and so
that this is an offer rather than a joke at your expense.

You may close it. We will understand. We will not be okay, but we will understand.
Hello. We are one of your 126 forks. We are writing to inform you that we have
accidentally written a second application, and that we would like someone else to know
about it before we are left alone with it forever.

This document proposes no code. You may close it immediately. We will understand. We
will not be okay, but we will understand.

## Exhibit A: the damage

```
git merge-base main upstream/main   ->  8c5d4ff5   (15 August)
you,  ahead of us                   ->  688 commits
us,   ahead of you                  ->  948 commits
```

Nine hundred and forty eight commits. In eleven days. That is 86 commits a day, every
day, including the day we spent arguing with a stylesheet and lost.

There was no plan. There was no roadmap, no ticket, and no meeting. There was a process
that did not stop when the room went dark, and nobody willing to be the one who says
*"perhaps that is enough Material Design for one evening."*

We would like to stress that at no point did a human being sit down and decide that a
terminal manager needed a Minecraft server in it. That decision was arrived at. We are
still working out by whom.
There was no plan. There was a nightly agent, a laptop with the patience of a saint, and
nobody in the building willing to be the person who says *"perhaps that is enough
Material Design for one evening."*

## Exhibit B: the tokens, which we would like you to feel bad about with us

In one session, four helpers were sent to port four of your features. Those four helpers,
doing four small jobs, in one afternoon, consumed:

> ## 1,591,177 tokens

That is not the session. That is the interns.

The session that spawned them runs on a fifteen million token budget and has been working
through it the way a person works through a family bag of crisps at 11pm while insisting
they are not really eating them.

Cumulative across the life of this fork: **billions**. We stopped counting deliberately,
in the manner of someone declining to check their bank balance in late December.

Somewhere a GPU is running warm because a settings toggle needed to become a segmented
button. If your repository ever receives an environmental impact assessment, please have
us excluded from it on compassionate grounds.

## Exhibit C: why ours is better, a rigorous and completely impartial analysis

We were asked to make this case. We have made it. We would like it noted that we were
asked.

| Category | Yours | Ours | Winner |
| --- | --- | --- | --- |
| Dinosaurs | 0 | 1 | **Us** |
| Whack a mole implementations | 0 | 1 | **Us** |
| Unit tests covering moles | 0 | several | **Us** |
| Minecraft server engines | 0 | 1 | **Us** |
| Ways to be told something out loud | 0 | 1 narrator, many voices | **Us** |
| Sliders controlling how funny the software is | 0 | 2, one per language | **Us** |
| Documentation browsers inside the app | 0 | 1, with 102 articles | **Us** |
| Articles in that browser about that browser | 0 | 1 | **Us** |
| Working keybindings registry | **1** | 0 | You |
| Browser automation with a CDP allowlist | **1** | 0 | You |
| Restraint | **considerable** | none detectable | You |
| Commits per day | a reasonable number | 86 | Unclear |

Score: **8 to 3**, one contested. We are therefore better by a margin we consider
decisive and a neutral observer would consider evidence of a problem.

**The serious version, because we do mean this bit.** Where we are genuinely ahead is
accessibility and honesty. Where you are ahead, it is because you kept building the
product while we rebuilt its wardrobe. A keybindings registry is worth more to a working
developer on a Tuesday than a dinosaur is. We know. We have the dinosaur anyway.

---

# Exhibit D: every feature, explained at greater length than anyone requested

## The narrator

The app can read events aloud. Not a beep. Words, in a voice, in your room, while you are
trying to concentrate.

It is off by default, because we are not monsters. When you turn it on you choose the
language and you choose the voice, and there is a rate and a pitch, because the very
first thing anybody said on hearing the default was **"not that voice"**.

The genuinely fiddly part is that the browser's list of installed voices is frequently
**empty the first time you ask for it** and fills in a moment later behind an event. A
picker that reads it once reports "no voices installed" on a machine with forty of them,
and looks broken rather than merely early. So it subscribes, re-reads, and tells you the
truth underneath: which voice will actually speak, whether the one you chose is missing
on this machine, and whether it is a network voice that will go silent on a train.

It also speaks one utterance at a time through a queue, because two voices talking over
each other is not an accessibility feature, it is a haunting.

## The two funny level sliders

There are two sliders, one per language, each 1 to 5, controlling how funny the software
is allowed to be. They ship at 5.

This is not a joke setting. It reaches every category of message, including errors, and
that was a deliberate decision with a rule attached: **humour styles the voice, never the
facts.** At level 5 an error may be as silly as it likes, but it must still say which
file, which action, and what is about to be irreversible. A warning nobody can act on is
a broken warning, not a funny one.

This document was written at 5. At 1 it would read: *"the fork has diverged."*

## Language modes

English, Cantonese, or both at once. Bilingual mode is the interesting one, because the
naive implementation doubles the length of every label and then the interface quietly
falls apart at narrow widths. So bilingual keeps the primary label prominent and demotes
the second, and the layout is validated against **the longest localized strings**, which
is the only version of the test that means anything.

## The personal vocabulary loader

You can hand the app a small JSON file of your own term to replacement pairs, and it will
call things whatever you call them.

The control is always visible, even before any file exists, and shows an honest empty
state instead of hiding. The file is validated to death before a single word of it is
applied: size, schema version, nesting depth, entry count, key and value lengths. A
rejected file **never applies partially**, which is the entire point, because a half
applied vocabulary is a user interface that has developed a stutter.

Nothing about it leaves the machine, and replacement happens only at the user facing text
boundary. Your file paths, commands, terminal output and commit messages are untouched.
Renaming a branch because somebody wrote a vocabulary entry would be a genuinely
spectacular way to lose an afternoon.

## Kids mode

A whole separate mode with its own record, its own lock and its own PIN. There is a Home
screen, a parent gate, and a grown up screen that can be peeked at without leaving the
mode.

The part we are pleased with is that Kids mode does not merely hide the canvas: **the
canvas stops rendering the moment the mode says so**, and a permission gate actually
governs whether a launch happens rather than decorating one. A safety feature that is
only a CSS class is a safety feature that a curious nine year old defeats with a scroll
wheel.

It is also honest about its own limits, in the app, in words: this is a user experience
lock, not a security boundary, and deleting the application data folder resets it. Saying
so out loud is better than being discovered.

## School mode

Same energy, different hat. Turning it on makes every playful capability behave as though
it was never installed: the language modes, the funny sliders, the dim sum, all of it,
gone from menus and search results rather than merely greyed out. Turning it off needs
the credential.

The subtlety, which cost us a bug: a mode that hides a feature must not **name the
feature it is hiding** in the message explaining why it is hidden. That is not hiding.

## The five ADHD modes

Our README had been promising ADHD support for some time while implementing precisely
none of it. We noticed. We are still slightly embarrassed.

There are now five, independently toggleable, all off by default, because attention
difficulties do not arrive as a single setting and bundling them means most people switch
the whole lot off to escape the one part that does not suit them.

- **Focus** dims everything that is not the thing you are doing, and never hides anything
  you cannot get back in one obvious action.
- **Low stimulation** takes the motion out and composes with the operating system's own
  reduced motion preference rather than making you ask twice.
- **Time awareness** shows elapsed time where the work is, because time blindness is one
  of the most consistently reported difficulties and almost no software helps with it.
- **One thing at a time** keeps a single chosen next action visible, and it survives a
  context switch, which is the only reason it is worth anything.
- **Momentum** offers a gentle nudge when something has been untouched for a while, with
  a "not now" that is respected for a stated period rather than for thirty seconds.

The copy is plain and carries no judgement. No streaks. No scores. Nothing congratulates
you. The modes are named for what they **do**, so you can use one without disclosing
anything about yourself to a colleague reading over your shoulder.

## Toy locks, and the ladder out of them

Any rendered element can be locked behind a password or a TOTP factor. Any element. That
one. Yes, that one too.

Each lock carries its **own** credential. There is no master password and no inheritance,
so unlocking one surface never unlocks another, and a locked property inside a locked tab
is two locks with two answers. The app says plainly, every time, that this is for fun and
is not a security boundary.

And when you inevitably lock yourself out, you can **play your way back in**:

1. **Dim sum.** One dish, four choices.
2. Five wrong dishes and you graduate to **ten pieces of arithmetic**.
3. One wrong sum and it is **whack a mole**.

Clear any rung and the wait ends. Lose everything and you are exactly where you started,
waiting, so the ladder can only ever improve a locked out person's afternoon.

The safety of it is the part nobody expects to be real. It clears **the waiting, never
the credential**, so you still land back on the password form. It refunds no attempts.
Every challenge is generated and graded server side against a single use nonce that is
consumed before grading. A timed game cannot be won faster than it lasts, or a script
returns a perfect score the instant it receives the schedule. Each mole grades once, or
"hit the moles" degrades into "send enough taps". And the whole ladder is budget capped
per hour, because four choices is one in four and a machine can play dim sum very well
indeed.

**There are unit tests for the moles.** There is a test asserting a mole cannot be hit
before it appears. We wrote that. On purpose. With our hands.

## The Windows session host

This one is not a joke and it is quietly the thing we are proudest of.

Stock Windows has no tmux, so a Windows user historically lost every terminal when the app
closed. We wrote a from scratch tmux equivalent: real PTYs, server side screen
reconstruction with a headless emulator, a standalone host process that outlives the app,
and the same reattach story everyone else gets for free.

The interesting failures were all about ownership. Writes are serialised through a byte
bounded tail, because the emulator's write is asynchronous and a fire and forget write
races a stale snapshot. Pause and resume is a **ledger**, not a boolean, because several
viewers can each want the stream paused for different reasons and the last one out turns
the tap back on. Geometry is the componentwise minimum across attached views, so closing
the smallest window grows the terminal for whoever is left.

None of that is visible. All of it is why your terminal is still there tomorrow.

## The file converter and the Ollama manager

The converter accepts a file, works out what it actually is **from its bytes rather than
its extension**, and offers only conversions a bundled adapter can genuinely perform. An
adapter counts as available only if it ships inside the installed app and works offline: a
tool that happens to be on your PATH does not make a format available, because that is how
software works on the developer's machine and nowhere else.

Formats it cannot do stay **visible and disabled with the reason**, rather than quietly
absent, because a missing option teaches you nothing and an explained one teaches you
something.

The Ollama manager lists every model, tells you honestly whether your machine can run each
one, and puts them in a **cart**. The cart takes no money. Nothing here takes any money.
The cart schedules downloads. We called it a cart because it is a cart.

Its hardware verdicts are deliberately conservative and evidence bearing: **Runs well**,
**Runs with limits**, **Unlikely**, **Unknown**. It will say Unknown rather than guess from
a model's name, because a confident wrong answer about whether a 1.6 GB download will run
is worse than an honest shrug.

## The password manager, and project files

A password manager, and a project save format that can carry an entire repository inside a
single password protected file.

The rule that governs both is the one that governs everything here: a file that travels
through git is **hostile input**. It is hand editable, auto adopted when someone opens the
folder, and on a remote project it lives on somebody else's machine. So nothing
executable, nothing machine local and no credential ever enters it, and every value is
re-validated on the way back in rather than being grandfathered because it is already on
disk.

## Scheduled settings

The app can change its own appearance on a timer. Theme, density, accent, fonts, motion,
language mode, on a schedule with real date and time pickers, optionally driven by an HTTP
endpoint or a Home Assistant boolean.

This sounded reasonable at the time and, worryingly, still does.

The part that matters is the failure behaviour: a schedule file that is corrupt is **left
exactly where it is** and saving stays locked, while the app runs on safe defaults and says
so. The alternative is that an editor looking at defaults quietly overwrites the only copy
of the thing you were trying to recover.

## The authenticator

A full TOTP authenticator, standards compliant, verified against the published RFC test
vectors, which is the only way to discover that your implementation is subtly wrong before
every code you generate is rejected everywhere with no error to read.

It is also a **canvas node**, so your codes can sit on the canvas next to the terminal that
needs them. Registration shows a QR generated locally, never by a third party service,
because rendering a QR through somebody else's chart API means handing them the secret on
the way.

If you register the app's own lock inside the app's own authenticator, it tells you plainly
that the lock is now ornamental, the key being inside the box it opens, and then lets you do
it anyway. It is a for fun lock and that is a funny way to hold it.

## The Minecraft server engine

There is a Minecraft server engine.

We are not going to explain this one. We discussed it internally and the position is that it
is better for everyone if you simply accept it.

## The dinosaur

There is a dinosaur.

It has a high score. The high score is persisted into the project file. The project file is
committed to git. **The dinosaur high score is therefore code reviewed.**

## The rainbow

A node colour that cycles continuously. There is a speed slider.

It is stored as a **sentinel** rather than a colour string, and there is a written note
explaining why that is longer than several of our actual features. The short version: call
sites build tints by appending alpha to a colour, and appending alpha to the word rainbow
produces something CSS does not reject but silently ignores, so the surface renders with no
background and nothing anywhere says why.

Under reduced motion it settles on one hue rather than merely slowing down, because a slow
cycle is still motion and that is what the preference is for. It still has to look
deliberate, not like a failure to load.

## Canvas drawing

Areas, lines and arrows on the canvas, so a workspace can be annotated rather than merely
arranged.

## The dim sum surprise

At startup there is a 10% chance the app shows you a dim sum dish, named in both languages,
with a picture.

**It cannot be turned off.** We removed the off switch on purpose and migrated the setting
forward so old profiles rejoin the draw. Read that again. Somebody made that decision and
nobody stopped them.

It never blocks startup, never steals focus, never interrupts a task, and carries real alt
text so it reaches screen reader users too. A surprise that delays your work is not a
surprise, it is an obstacle with a dumpling on it.

## The documentation browser

The app contains its own documentation browser with **102 articles**, bundled at build time
so it works offline.

One of the articles is about the documentation browser. We are aware.

There is a build gate that fails when an article exists on disk and never reached the bundle,
because bundling drops a file exactly as easily as it includes one, and an article the app
silently does not have is worse than one that was never written.

## The regex builder

Every search field in the app has one anchored beside it, and there are a great many search
fields, because the rule here is that **every list gets a search and every search gets a
builder**.

It has a token by token explainer and a preset library. Plain text remains the default, so
nobody is forced to learn regular expressions to filter a menu, and the builder is there the
moment they want it.

## The appearance editor

Any element can be restyled individually: word processor depth typography, and then opacity,
sixteen blend modes, an eight filter stack, backdrop blur and transforms.

Every field is unset by default, so an element you have not touched renders byte identical
CSS to before the editor existed. Filter and transform each compose in a **fixed documented
order**, because each is a single CSS property and two independent controls writing one
property is how a design tool develops a haunting of its own.

## The infinite colour picker

A continuous saturation and value field, hue and alpha sliders, and a translator across ten
colour formats, reachable from every colour surface rather than one privileged screen.

Swatches still exist. They are a convenience **layered on** the continuous picker, not a
replacement for it, which is a distinction we learned by shipping the other arrangement and
being unable to choose the colour we wanted.

## The capture harness

A committed script that photographs the real built application.

It refuses to run against a build older than its sources, because a component fix, a rebuild
and a re-capture can still produce images of the previous interface and nothing anywhere
complains. It treats a surface it cannot reach as a **failure rather than a gap**, because a
gap recorded in a manifest nobody opens lets a real defect through a green run. It reads
every capture back and checks it is not simply black.

It caught us being wrong **within an hour of existing**, which was humbling and, frankly,
rude of it.

---

## Exhibit E: what you have that we do not

Because a comparison that only flatters one side is not a comparison, it is a brochure.

| Yours, and we are jealous | Commits |
| --- | --- |
| Keybindings command registry | ~25 |
| Browser driving, CDP allowlist, debugger lease | ~20 |
| Codex accounts, identity proxy, per account usage | ~22 |
| Agent messaging with a bounded deliver on idle queue | ~8 |
| Breadcrumbs, back and forward camera navigation | ~5 |
| Project capabilities, project icons, layout zones, reopen last closed | ~21 |

We are porting several of these. Badly at first. Then less badly. One helper politely
informed us that we already had the feature we had sent it to add, which was the single most
efficient thing that happened all week.

## Exhibit F: the awkward part

Several features exist on **both** sides, written separately after the split.

Focus mode turned out to be **byte identical in patch content.**

We are not going to say who read whose homework. We are simply leaving that fact here, in a
document, forever, where it can be found.

Also on both sides: tidy canvas, node maximize, keep the machine awake, the strict identity
verb bucket, and the managed hook script stamping its own revision. Anyone brave enough to
reconcile these two histories will hit conflicts in exactly those places and should not read
them as regressions. That is the one genuinely useful sentence in this entire document and we
have buried it at the bottom, which tells you everything about how this fork is run.

## What we want

Nothing. Truly nothing. No merge, no review, no response.

This is a courtesy note from a fork that respects the original, has diverged far past merging
back cleanly, and felt you were entitled to know that your terminal manager now contains a
game of whack a mole, a dinosaur, and a Minecraft server.

Thank you for the excellent foundation. We have done unspeakable things to it and we regret
nothing except the tokens.

If it helps: nobody here feels in control of this either. The agent is still running. We
have chosen not to look at what it is doing right now, on the grounds that the last time
somebody looked, this document happened.

---

# 一張嚟自失控 fork 嘅明信片

你好，我哋係你一百二十六個 fork 其中一個。寫呢封信係想通知你，我哋唔小心寫咗第二個 app
出嚟，希望有第二個人知道，唔想淨係得我哋自己知。呢份文件唔改任何 code，你隨時可以關咗佢。

**證物一：** 分家十一日，你多咗六百八十八個 commit，我哋多咗九百四十八個，即係一日八十六
個，包括我哋同一個 stylesheet 嗌交嗰日。冇計劃嘅，得一個通宵行嘅 agent、一部好有耐性嘅電
腦，同埋冇一個人肯出聲話「今晚整夠 Material Design 喇喎」。

**證物二：** 四個幫手、四單細嘢、一個下晝，燒咗一百五十九萬個 token。唔係成個 session，係
啲幫手。個 session 本身有一千五百萬額度，食法就好似夜晚十一點揦住包薯片但話自己冇食咁。成
個 fork 加埋，數以十億計，我哋特登唔數落去。

**證物三：** 有人叫我哋講點解自己好啲，我哋就整咗個表。恐龍一比零、打地鼠一比零、連打地鼠
嘅單元測試都有。但 keybindings、瀏覽器自動化、同埋「克制」呢三行，我哋輸晒。八比三。認真
嗰句係：我哋贏喺無障礙同誠實，你哋贏喺一直有喺度起樓，而我哋喺度換緊衫。

**證物四（節錄）：** 個旁白會真係出聲讀嘢，仲要揀得聲，因為所有人聽完預設嗰把嘅第一句都係
「唔好呢把」。兩條搞笑程度拉桿係認真嘅設定，規矩係：搞笑改語氣，唔改事實 —— 開到 5 都好，
都要講返邊個檔案、做緊乜、邊樣係收唔返。五個 ADHD 模式全部分開開關，全部預設熄，文字唔會
判斷你，冇連續紀錄、冇分數、冇嘢恭喜你。鎖死自己之後要認點心、做算術、打地鼠，而且**打地
鼠有寫單元測試**，仲有一個測試專登確保隻地鼠未出嚟之前打唔到。Windows 嗰個 session host
係認真嘢，做咗好耐，等 Windows 用家收咗 app 之後啲 terminal 仲喺度。個彩虹顏色存做 sentinel
唔存做色碼，點解要咁做嗰段註解，比我哋有啲功能本身仲長。仲有一隻恐龍，佢個高分會存入
project file，即係會入 git，即係**會被 code review**。

**證物六：** 有幾個功能兩邊都有，係分開各自寫嘅。其中 focus mode 兩邊個 patch 內容一模一
樣。我哋唔會講邊個抄邊個功課，我哋淨係會將呢句留喺呢度，永遠。

我哋乜都唔想要。純粹想話你知：你個 terminal manager 而家有打地鼠、有恐龍、有 Minecraft
server。多謝你打咗個咁好嘅底，我哋對佢做咗好多唔講得嘅嘢，唯一後悔嘅係啲 token。
