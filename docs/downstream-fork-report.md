# A postcard from a fork that got out of hand

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
day, including the day we spent arguing with a stylesheet.

There was no plan. There was a nightly agent, a laptop with the patience of a saint, and
nobody in the building willing to be the person who says *"perhaps that is enough
Material Design for one evening."*

## Exhibit B: the tokens, which we would like you to feel bad about with us

In **one** session, four helpers were sent to port four of your features. Those four
helpers, doing four small jobs, in one afternoon, consumed:

> ## 1,591,177 tokens

That is not the session. That is the interns.

The session that spawned them runs on a **fifteen million token** budget and has been
working through it the way a person works through a family bag of crisps at 11pm while
insisting they are not really eating them.

Cumulative, across the life of this fork: **billions**. We stopped counting deliberately,
in the manner of someone declining to check their bank balance in late December.

Somewhere a GPU is running warm because a settings toggle needed to become a segmented
button. It is fine. Everything is fine. We are fine. If your repository ever receives an
environmental impact assessment, please have us excluded from it on compassionate
grounds.

## Exhibit C: what we did with all that

The one sentence version: **we turned it into a Material Design 3 app**, and then
experienced what medical professionals would probably call an incident.

Here is the list. We apologise in advance. It does not stop when you want it to.

**Things that talk, or refuse to:**

- **A narrator.** It speaks. Out loud. In your room. There is a voice picker, because the
  first thing anyone said was "not that voice".
- **Language modes**, English and Cantonese and both at once.
- **Two independent funny level sliders**, one per language, from 1 to 5. This document
  was written at 5. At 1 it would simply say "the fork has diverged".
- **A personal vocabulary loader**, so the app can call things whatever you call them.

**Things that stop you doing something:**

- **Kids mode**, with a parent gate and a PIN, and a canvas that stops rendering the
  instant the mode says so.
- **School mode.** Same energy, different hat.
- **Five ADHD modes**, which our README had been confidently promising for some time
  while implementing precisely zero of them. We noticed. We fixed it. We are still a bit
  embarrassed.
- **Toy locks on individual elements.** Any element. That one. Yes, that one too.
- **A destructive action gate** with two keys and a slider, because one confirmation
  dialog is for people who have never deleted the wrong thing.

**The one where we lost the plot entirely:**

- When you lock yourself out, you can **play your way back in**. First you identify a dim
  sum dish. Get five wrong and you graduate to **arithmetic**. Fail that and it is
  **whack a mole**.
- It is budget capped so it can never become a weaker password, and the moles are graded
  server side so you cannot simply mash the thing.
- **There are unit tests for the moles.** There is a test asserting that a mole cannot be
  hit before it appears. We wrote that. On purpose. With our hands.

**Things that are genuinely serious and took ages:**

- **A Windows session host**: a from scratch tmux equivalent, real PTYs, server side
  screen reconstruction, so Windows gets the same cross restart persistence everyone else
  gets from tmux. This one is not a joke and we are quietly proud of it.
- **A file converter** with a bundled adapter registry, and an **Ollama manager** with a
  catalog, a queue, and a cart. The cart does not take money. Nothing here takes money.
- **A password manager** and **project files** that can carry the whole repository inside
  a single password protected save.
- **Scheduled settings**, so the app can change its own appearance on a timer, which
  sounded reasonable at the time and still does, worryingly.
- **A built in TOTP authenticator**, which is also a canvas node, because why would it not
  be.

**Things nobody asked for:**

- **A Minecraft server engine.** We are not going to explain this one. We have discussed
  it internally and the position is that it is better if you simply accept it.
- **A dinosaur.** There is a dinosaur. It has a high score. The high score is persisted
  into the project file, which means it is committed to git, which means it is code
  reviewed.
- **An animated rainbow node colour**, with a speed slider, and a documented note
  explaining why the rainbow is stored as a sentinel rather than a colour string. That
  note is longer than some of our features.
- **Canvas drawing**: areas, lines, arrows.
- **A dim sum surprise** on startup, at a 10% chance, which cannot be turned off. We
  removed the off switch on purpose. Read that sentence again.

**Things that suggest we are, at heart, quite responsible:**

- **An in app documentation browser** with 102 articles bundled at build time. One of the
  articles is about the documentation browser. We are aware.
- **A changelog viewer**, **local version history**, a **notification centre**, **bulk
  actions**, **exports**, **external editor handoff**, and a **command palette**.
- **A regex builder** with a token by token explainer and a preset library, anchored to
  every search field in the app, of which there are many, because the rule here is that
  every list gets one.
- **A per element appearance editor** with word processor depth typography plus opacity,
  sixteen blend modes, an eight filter stack and transforms.
- **An infinite colour picker** with a ten format translator, reachable from every colour
  surface.
- **A capture harness** that photographs the built artifact, refuses to run against a
  stale build, treats an unreachable required surface as a failure rather than a gap, and
  reads every capture back to check it is not simply black. It caught us being wrong
  within an hour of existing, which was humbling and, frankly, rude of it.

## Exhibit D: why ours is better, a rigorous and completely impartial analysis

We were asked to make the case. We have made it. We would like it noted that we were
asked.

| Category | Yours | Ours | Winner |
| --- | --- | --- | --- |
| Dinosaurs | 0 | 1 | **Us** |
| Whack a mole implementations | 0 | 1 | **Us** |
| Unit tests covering moles | 0 | several | **Us** |
| Minecraft server engines | 0 | 1 | **Us** |
| Ways to be told something out loud | 0 | 1 narrator, many voices | **Us** |
| Sliders controlling how funny the software is | 0 | 2, one per language | **Us** |
| Documentation browsers built into the app | 0 | 1, containing 102 articles | **Us** |
| Articles in that browser about that browser | 0 | 1 | **Us** |
| Working keybindings registry | **1** | 0 | You |
| Browser automation with a CDP allowlist | **1** | 0 | You |
| Restraint | **considerable** | none detectable | You |
| Commits per day | a reasonable number | 86 | Unclear |

Score: **8 to 3**, with one contested. We are therefore better by a margin that we
consider decisive and that a neutral observer would consider evidence of a problem.

**The serious version, briefly, because we do actually mean this bit.** Where we are
genuinely ahead is accessibility and honesty: language modes, funny levels, a narrator,
five ADHD modes, Kids and School modes, an unlock ladder that never becomes a weaker
password, and a rule that a control which looks like it works must actually work. We
found and fixed a button that had been rendering white text on light lavender for
months, in the dark theme, on the most prominent action in the app, because a document
had recorded the bug and nobody had gone back for it. That is the kind of better we are
claiming.

Where you are ahead, you are ahead because you kept building the product while we
rebuilt its wardrobe. A keybindings registry is worth more to a working developer on a
Tuesday than a dinosaur is. We know. We have the dinosaur anyway.

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

We are porting several of these. Badly at first. Then less badly. One of our helpers
politely informed us that we already had the feature we sent it to add, which was the
single most efficient thing that happened all week.

## Exhibit F: the awkward part

Several features exist on **both** sides, written separately after the split.

Focus mode turned out to be **byte identical in patch content.**

We are not going to say who read whose homework. We are simply going to leave that fact
here, in a document, forever, where it can be found.

Also on both sides: tidy canvas, node maximize, keep the machine awake, the strict
identity verb bucket, and the managed hook script stamping its own revision. Anyone brave
enough to reconcile these two histories will hit conflicts in exactly those places and
should not read them as regressions. That is the one genuinely useful sentence in this
entire document and we have buried it at the bottom, which tells you everything about how
this fork is run.

## What we want

Nothing. Truly nothing. No merge, no review, no response.

This is a courtesy note from a fork that respects the original, has diverged far past
merging back cleanly, and felt you were entitled to know that your terminal manager now
contains a game of whack a mole, a dinosaur, and a Minecraft server.

Thank you for the excellent foundation. We have done unspeakable things to it and we
regret nothing except the tokens.

---

# 一張嚟自失控 fork 嘅明信片

你好，我哋係你一百二十六個 fork 其中一個。寫呢封信，係想通知你我哋唔小心寫咗第二個 app
出嚟，希望有第二個人知道呢件事，唔想淨係得我哋自己知。

呢份文件唔改任何 code，你隨時可以關咗佢。我哋會理解。我哋唔會冇事，但我哋會理解。

**證物一：** 分家十一日，你多咗六百八十八個 commit，我哋多咗九百四十八個。即係一日八十六
個，包括我哋同一個 stylesheet 嗌交嗰日。冇計劃嘅，得一個通宵行嘅 agent、一部好有耐性嘅
電腦，同埋成間屋冇一個人肯出聲話「今晚整夠 Material Design 喇喎」。

**證物二：** 派四個幫手去搬你四個功能，一個下晝，燒咗 1,591,177 個 token。唔係成個
session，係四個幫手。個 session 本身有一千五百萬額度，食法就好似夜晚十一點揦住包薯片但
話自己冇食咁。成個 fork 加埋？數以十億計。我哋特登唔數落去，好似十二月唔敢碌卡咁。

**證物三：** 我哋整咗個 Material Design 3 版本，然後就出咗事。會出聲嘅旁白、兩條分開嘅
搞笑程度拉桿（呢份文件係開到 5，開 1 嘅話佢淨係會講「個 fork 分咗家」）、兒童模式、校園
模式、五個 ADHD 模式、每粒掣都可以上鎖。鎖死自己之後要認點心、做算術、再打地鼠先出得返
嚟，而且**打地鼠有寫單元測試**，仲有一個測試專登確保隻地鼠未出嚟之前打唔到。係我哋親手
寫㗎。

認真嗰啲都有：Windows 版嘅 tmux（真係做咗好耐，幾自豪）、檔案轉換、Ollama 管理、密碼管
理、排程設定、內置驗證器。冇人叫我哋做嗰啲都有：一個 Minecraft server engine（呢個唔解
釋）、一隻恐龍（佢個高分會存入 project file，即係會入 git，即係會被 code review）、一個
關唔到嘅點心驚喜。

**證物五：** 有幾個功能兩邊都有，係分開各自寫嘅。其中 focus mode 兩邊個 patch 內容一模
一樣。我哋唔會講邊個抄邊個功課，我哋淨係會將呢句留喺呢度，永遠。

我哋乜都唔想要。純粹想話你知：你個 terminal manager 而家有打地鼠、有恐龍、有 Minecraft
server。多謝你打咗個咁好嘅底，我哋對佢做咗好多唔講得嘅嘢，唯一後悔嘅係啲 token。
