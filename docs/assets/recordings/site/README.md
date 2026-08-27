# Documentation site capture and recording inventory

This inventory covers the current documentation and landing surface recorded from commit
[`1ec54fa8`](https://github.com/Ding-Ding-Projects/material-nodeterm/commit/1ec54fa88552e9286090597d048534fcc8d51e93).
The static `site/` output was assembled byte-for-byte, served on a task-owned loopback endpoint,
and opened in one isolated Microsoft Edge page on an off-screen Windows desktop. The complete
target list was rechecked before interaction, capture, and the final verdict.

The machine-readable records are in [`capture-manifest.json`](./capture-manifest.json) and
[`evidence-inventory.json`](./evidence-inventory.json). Every listed SHA-256 is checked against
the committed file.

## Key still captures

| ID | Surface and state | Viewport | SHA-256 |
| --- | --- | --- | --- |
| `site-hall-current` | Searchable hallway with one Jump control | 1440 by 1000 | `de3135cafb8763bb2e7670702e583d8315c05bd6b5c8edd1b0ed1586f068b63c` |
| `site-home-current` | Home room with v0.4.120 and the Windows installer route | 1440 by 1000 | `b41cee3ba61a431cea919302fb0b82b6b8ef804e4015245b2c170cf857c55232` |
| `site-docs-current` | Documentation index with bulk selection | 1440 by 1000 | `fa170c009b996e2eea87177475549cc4c398974d035abeab184a155c23d792fe` |
| `site-changelog-current` | Windows-scope changelog with the v0.4.120 overlay | 1440 by 1000 | `c62ebe9844baf4d8c4d6830311655727d3ecb2712a60c3000389fc8cd95b307c` |
| `site-settings-current` | Settings overview | 1440 by 1000 | `2f3570a3c79cc1c3697f02bcd50528c64d12ccc99db74c28c8b0c61e2b9c4c8f` |
| `site-screenshots-current` | Built-application capture gallery | 1440 by 1000 | `bc9c509a17d254a4a517df0847d2798ef512b6f60303fa65b0708fcc20871717` |
| `site-search-regex-current` | Settings search with the pattern builder open | 1440 by 1000 | `452a111bee45fae411057b313235efbc418a3f0f71082de5bf64b010b01969c7` |
| `site-appearance-current` | Appearance card isolated by the real settings search | 1440 by 1000 | `d5145f45895f5bde54c6727b94a405c9558b329b5803ea3a05ad833ea512b9b2` |
| `site-mobile-home-current` | Emulated mobile navigation with touch enabled | 390 by 844 | `8c764f9ac9a1f94aa0a47c7fd0c23c0dfa211a00f58f3064f8613438f467a75e` |

## Destination recordings

Each GIF begins in the real hallway, activates the named door, and ends on the resulting room.

| ID | Destination | GIF | SHA-256 |
| --- | --- | --- | --- |
| `room-home` | Home | [`site-room-home.gif`](./site-room-home.gif) | `b23511f98d1762b29b3b65d2036fa6d463622bf8dda79263851809c10c5a122c` |
| `room-docs` | Guide book | [`site-room-docs.gif`](./site-room-docs.gif) | `6ae59faa66de206f86f67ae183973f323cd918227fc0c52b8d2dcfa6b51c76bc` |
| `room-changelog` | What changed | [`site-room-changelog.gif`](./site-room-changelog.gif) | `05787a38071125effec6fd380f0d1a49644b3ae8abfd289d157c08d11c87c044` |
| `room-notes` | Messages | [`site-room-notes.gif`](./site-room-notes.gif) | `c6bc028df52061ce75219f45882ce828b0e38ea2c9ad4d2b0004c6118f7fdba8` |
| `room-history` | Time machine | [`site-room-history.gif`](./site-room-history.gif) | `9418e4fb147e90bea942f0cb1cb21b9ad8debe0fc94b1b45588be46cfad2d1ea` |
| `room-auth` | Code maker | [`site-room-auth.gif`](./site-room-auth.gif) | `6c3f0d42b47d7f68499cb519a66280f9509c068366486bbec86b6f0e0661be20` |
| `room-shop` | Model shop | [`site-room-shop.gif`](./site-room-shop.gif) | `722f7cb677e38a1a094e224bf46233c96fe28baaf25e803462084f020c5724ee` |
| `room-convert` | Turn-it-into | [`site-room-convert.gif`](./site-room-convert.gif) | `cf08eeb0070bd903c7b58aa6e46d497531d23233497845bbef5a3c6a8207e731` |
| `room-export` | Take it home | [`site-room-export.gif`](./site-room-export.gif) | `03bd6ff0107fbc2d29c9a15eb7cc74d8a0c5844b463b2a189a512cf6faf82309` |
| `room-dish` | Dim sum | [`site-room-dish.gif`](./site-room-dish.gif) | `5b7e2f682eb76f3a71a57b39350a00fabaa20378a5f20bad7cb8c32b222f4201` |
| `room-coverage` | Checklist | [`site-room-coverage.gif`](./site-room-coverage.gif) | `eae3dd8fa7e4ccdd1951b7ecd7711e71849420545117f75b94f995c99b2812d4` |
| `room-shots` | Screenshots | [`site-room-shots.gif`](./site-room-shots.gif) | `cffa5f15e526f008566e5150050f94710ba2e04cccb3af14f8aedc169db0dc07` |
| `room-pair` | Remote access | [`site-room-pair.gif`](./site-room-pair.gif) | `50b4f3b78a6cad860e540e61c5afb370fa5d9a4944e4f17a3f5fa1a2421bb313` |
| `room-play` | Playroom | [`site-room-play.gif`](./site-room-play.gif) | `7354753f84f1c7f55927977a5e540188a7664a7d5bea40ee256e51c6f6c8419c` |
| `room-settings` | Settings | [`site-room-settings.gif`](./site-room-settings.gif) | `d83932e8c5f1c826dd291eed30c8de8e674fc47c6927f96453de3ddff7b249e4` |

## Settings feature recordings

Each GIF opens the real Settings room, focuses its search field, types the feature name through
the browser input path, and ends with the exact matching card visible.

| ID | Feature | GIF | SHA-256 |
| --- | --- | --- | --- |
| `setting-you` | About you | [`site-setting-you.gif`](./site-setting-you.gif) | `eec3b8a35f55d89a7bec540011122e99a40cf69b984a940252a7640859dca814` |
| `setting-look` | How it looks | [`site-setting-look.gif`](./site-setting-look.gif) | `380d798160c344233989bfb30cd009722db6423910581910731683fb9396904f` |
| `setting-words` | Words and jokes | [`site-setting-words.gif`](./site-setting-words.gif) | `a8cac99b7957b24f153d105bf23f6a961285cd6226cb5378f5c70df5a49a5c62` |
| `setting-narrator` | Read it to me | [`site-setting-narrator.gif`](./site-setting-narrator.gif) | `5de2d9a5f2de9a8d137f72ece5d0b2c5c53b0652944230609c374ed04907260a` |
| `setting-school` | School mode | [`site-setting-school.gif`](./site-setting-school.gif) | `d002b0c59c27d244908eb347382ab13c303ceea312d0bad96e6866e013674980` |
| `setting-vocab` | My own words | [`site-setting-vocab.gif`](./site-setting-vocab.gif) | `ff4e16ac5740e4f345d16b596b6758fa60b5adf651091420b1dc5b175c438051` |
| `setting-safety` | Toy locks | [`site-setting-safety.gif`](./site-setting-safety.gif) | `2ddc42f80e8618439d1a255dc8eddaaca1424a86c5a9e70a54982ae4ab0b5943` |
| `setting-timers` | Timers | [`site-setting-timers.gif`](./site-setting-timers.gif) | `68f263344e74e62fac69e56a91ff5df315c832f88dfc62f426fd89c86d387de5` |
| `setting-demo` | Download demo | [`site-setting-demo.gif`](./site-setting-demo.gif) | `fea7ad20af00254ccb74c8e509ac0ec2db5a373e8435ccbb56401b3569408344` |
| `setting-adhd` | ADHD modes | [`site-setting-adhd.gif`](./site-setting-adhd.gif) | `d9b16f57fbf01bb79464d64c7e9bacd1e9879f8e89f2d4495745de313b916849` |

## Runtime verdict and limitations

- Desktop viewport: 1440 by 1000 at scale 1.
- Emulated mobile viewport: 390 by 844 at scale 1 with touch emulation enabled.
- Console errors, unhandled exceptions, failed resources, unexpected third-party requests, and
  analytics requests: zero.
- Unnamed interactive accessibility nodes: zero at both viewports.
- Body overflow: false at both viewports.
- The GIFs are 720 by 450 visual derivatives of the retained raw PNG frame sequences. They have
  no audio and do not replace the raw key captures as evidence.
- The mobile capture is browser emulation, not proof from a physical device.
