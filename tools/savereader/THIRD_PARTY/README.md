# Third-party code and data in tools/savereader

All of it is used read-only: the reader decrypts an in-memory copy of a save and never writes one.
No encryption code is shipped (MHWCrypto's Iceborne `EncryptRegion` was removed).

## License amendment (MHWSaveUtils, MHWCrypto, MHWMasterDataUtils)

The upstream READMEs add this amendment to the MIT license, and it applies to this copy too:

> DO NOT use this code, in part or in totality, to cheat, or produce code that would eventually lead to cheat.

This tool only reads a copy of the player's own save to show progress. It does not modify saves,
memory or network traffic.

## Pinned sources

| Upstream | Commit | Files | License |
|---|---|---|---|
| [TanukiSharp/MHWSaveUtils](https://github.com/TanukiSharp/MHWSaveUtils) | `aad1e19aed2fd41158b2dd3e3bb8582ffb4df1a8` | `MHWSaveUtils/SaveDataReaderBase.cs`, `Constants.cs`, `MonsterStatsReader.cs`, `WeaponUsageReader.cs`, `Enums.cs` (unmodified); `SaveDataInfo` struct extracted from `FileSystemUtils.cs` | MIT + amendment, `MHWSaveUtils/LICENSE`, `MHWSaveUtils/README.md` |
| [TanukiSharp/MHWCrypto](https://github.com/TanukiSharp/MHWCrypto) (the submodule commit pinned by MHWSaveUtils) | `41b04e1615783e10db49e1b56d14149a6224fecd` | `MHWCrypto/Blowfish.cs`, `Crypto.cs` (unmodified), `CryptoSecondLayer.cs` (`EncryptRegion` removed) | MIT + amendment, `MHWCrypto/LICENSE`, `MHWCrypto/README.md` |
| [Fusion86/Cirilla](https://github.com/Fusion86/Cirilla) | `a1e065435e11b0fd102ad0395c1c63a1c86b04af` | `CryptoSecondLayer.cs` is upstream's copy of Cirilla's `IceborneCrypto.cs`; `misc/savedata.bt` used to cross-check monster indices | MIT, `Cirilla/LICENSE` |
| [TanukiSharp/MHWMasterDataUtils](https://github.com/TanukiSharp/MHWMasterDataUtils) | `8c25b6256f1a604183c386e2211900f53d24019f` | `Data/jewels.json` derived from `MHWMasterDataUtils.Exporter/data/jewels.json` (kept: equipmentId, id, English and Spanish names; 404 jewels). `Data/equipment.json` derived from `heads/chests/arms/waists/legs.json` (keyed by `setGroup`, 1643 pieces) and the 14 weapon files (keyed by `sortOrder`, 3681 weapons), the keys MHWSaveUtils' `MasterData` uses; kept: id, rarity, English and Spanish names | MIT + amendment, `MHWMasterDataUtils/LICENSE`, `MHWMasterDataUtils/README.md` |

Not vendored (Windows-only or network): `FileSystemUtils` (Steam path via `Microsoft.Win32.Registry`),
`SaveDataFileMonitor`, `MasterData` (downloads data over HTTP at runtime), `DecorationsReader` and
`EquipmentReader` (depend on `MasterData`). `SlotReader.cs` re-implements the decorations walk with the same
offsets and the embedded jewel table.

## Facts taken from other projects (no code copied)

- Monster indices 59, 66, 67, 68 and 70 (Scarred Yian Garuga, Furious Rajang, Raging Brachydios,
  Frostfang Barioth, Fatalis): `monsters96` order in
  [EnderHDMC/MHWISaveEditor](https://github.com/EnderHDMC/MHWISaveEditor) `res/mapping/010 Editor/SAVEDATA1000.bt`
  at `31ed4505fe18d92dd17a2c7c4152aa7093a8d8ac`. It agrees with Cirilla for every other index, and a real save
  agrees with it (index 67 has no size records, as expected for fixed-size Raging Brachydios; index 68 has captures).
- Iceborne base sizes and the Savage/Rajang crown presets: SmartHunter's `MonsterDataConfig` (in-quest crown data).

## Equipment, quest counters and achievements (format 1, additive fields)

- `equipment.armor` / `equipment.weapons`: the 2500-entry equipment box (126-byte entries, same walk as
  MHWSaveUtils' `EquipmentReader`: sort index, category, piece/weapon type, class id). It lists what is in the box
  **now**; sold or melted pieces are gone, so it is not an "ever crafted" record. The game master data in
  `Data/equipment.json` stops around Title Update 3/4 (no Alatreon, Fatalis or Raging Brachydios pieces): such ids
  are still reported, with null names.
- `quest_counts` and `achievements_unlocked`: guild card fields located with EnderHDMC/MHWISaveEditor's
  `mhw_guild_card` layout (no code copied). On a real save the bitfield equals the Steam achievement list (80/100)
  and the counters equal the second copy of them in the slot's `mhw_save_quests` block.
- `quests.cleared`: the 64-byte bitfield at slot +1757671 (unnamed `unknown12b` in the template, between
  `unlocked_optionals` and `seen_optionals`). Bit i = i-th quest id of the game's `nativePC/quest/questNoList.qnlt`
  (header u32 0x18091001, u16, u32 count = 352, then u32 quest ids, which are MHWorldData ids). `Data/quest_order.json`
  keeps only that id list, extracted from the user's own game chunks with WorldChunkTool `-Filter quest\`. Evidence:
  no bit is set beyond index 351 in any of the three bitfields; all 53 assigned quests are set (all story
  achievements are unlocked); distinct cleared quests per rank (LR 69, HR 96, MR 159, arena 13) stay below the
  guild card counters (144/284/314/51); and 333 of 335 objective monsters of cleared quests have a hunt count above 0.
  The two exceptions are Safi'jiiva sieges (see research/save_format/open_questions.md).
- `SlotExtras.cs` (hunter XP, guild card title/greeting/squad, palico name/XP/gadget XP, Guiding Lands levels,
  investigations, 128-index monster log, current equipment and saved loadouts) uses slot offsets computed from the
  template (its struct sizes add up to exactly 2,136,768 bytes per slot). `Data/monsters128.json` is the template's
  `mhw_monster_index` enum; checked against the guild card's 96-index table: 67 of 68 shared monsters match exactly.
- The smithy bitfields are "seen in the smithy list" flags, not "crafted" flags. Open items: research/save_format/open_questions.md.

## Bug fixed relative to MHWSaveUtils

`MonsterStatsReader` walks `MonsterData.Values` with a running counter, so every monster after the gap at
index 59 is read from the previous index (for example "Brute Tigrex" gets Scarred Yian Garuga's data).
`MonsterTable.cs` keys by the real save index instead.
