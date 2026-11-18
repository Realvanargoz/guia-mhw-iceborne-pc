using System;
using System.Collections.Generic;
using System.IO;
using MHWSaveUtils;

namespace MhwSaveReader
{
    public sealed class SlotData : SaveSlotInfoBase
    {
        public SlotData(SaveSlotInfoBase b) : base(b) { }

        public ushort[] Captured = Array.Empty<ushort>();
        public ushort[] Slayed = Array.Empty<ushort>();
        public ushort[] Largest = Array.Empty<ushort>();
        public ushort[] Smallest = Array.Empty<ushort>();
        public byte[] ResearchLevel = Array.Empty<byte>();
        public WeaponUsage LowRank, HighRank, Investigations, MasterRank, GuidingLands;
        /// <summary>Jewel item id -> count (item box + slotted in equipment + slotted in specialized tools).</summary>
        public Dictionary<uint, uint> Decorations = new();
        /// <summary>Slotted equipment ids that are not present in the jewel table.</summary>
        public Dictionary<uint, uint> UnknownSlottedJewels = new();
        /// <summary>Equipment box (currently owned pieces): (armor piece type, class id) -> count.</summary>
        public Dictionary<(uint Type, uint Id), uint> Armor = new();
        /// <summary>Equipment box (currently owned weapons): (weapon type, class id) -> count.</summary>
        public Dictionary<(uint Type, uint Id), uint> Weapons = new();
        /// <summary>Equipment box: charm class id (master data setGroup) -> count.</summary>
        public Dictionary<(uint Type, uint Id), uint> Charms = new();
        /// <summary>Absolute offset of this slot in the decrypted buffer.</summary>
        public long Start;
        /// <summary>Guild card quest counters: low rank, high rank, investigations, arena, master rank, guiding lands.</summary>
        public ushort[] QuestCounts = new ushort[6];
        /// <summary>Slot achievement bitfield (bit N = Steam "AchievementN").</summary>
        public byte[] Achievements = Array.Empty<byte>();
    }

    /// <summary>
    /// Reads all three slots in one pass over a decrypted save. Offsets are the ones used by MHWSaveUtils'
    /// MonsterStatsReader, WeaponUsageReader and DecorationsReader, expressed relative to the start of each slot.
    /// Every read is position-checked so a truncated or inconsistent buffer throws instead of returning garbage.
    /// </summary>
    public sealed class SlotReader : SaveDataReaderBase<SlotData>
    {
        public const long SlotSize = 2_136_768; // 4 (unknown) + 2_136_252 + 512 (hash)
        private const long CompletedQuests = 2_008_323; // mhw_save_quests
        private const long AchievementsObtained = 2_008_287; // u8[16], bit N = Steam "AchievementN"
        private readonly IReadOnlyDictionary<uint, uint> jewelItemByEquipmentId;

        public SlotReader(Stream decrypted, IReadOnlyDictionary<uint, uint> jewelItemByEquipmentId) : base(decrypted)
        {
            this.jewelItemByEquipmentId = jewelItemByEquipmentId;
        }

        public override IEnumerable<SlotData> Read()
        {
            GotoSection3PastSignature();
            Skip(4); // section unknown
            long sectionSize = reader.ReadInt64();
            long first = reader.BaseStream.Position;

            // The section declares its own size: a copy cut anywhere inside it (or right after it) is rejected.
            if (sectionSize < 3 * SlotSize || sectionSize > saveDataLength)
                throw new FormatException($"Invalid section 3 size ({sectionSize})");
            if (first + sectionSize > saveDataLength)
                throw new EndOfStreamException($"Save is truncated: section 3 ends at {first + sectionSize} but the file has {saveDataLength} bytes");

            if (first + 3 * SlotSize > saveDataLength)
                throw new EndOfStreamException($"Save is too short for 3 slots (need {first + 3 * SlotSize} bytes, have {saveDataLength})");

            var result = new List<SlotData>();
            for (int i = 0; i < 3; i++)
            {
                long start = first + i * SlotSize;
                var slot = ReadSlot(i + 1, start);
                if (slot != null) result.Add(slot);
            }
            return result;
        }

        private void Seek(long pos) => reader.BaseStream.Position = pos;

        private SlotData? ReadSlot(int slotNumber, long start)
        {
            Seek(start);
            Skip(4); // unknown
            var slot = new SlotData(ReadUntilPlaytimeIncluded(slotNumber)) { Start = start };
            if (slot.Playtime == 0)
                return null;

            // GUILDCARD of the hunter: starts after H_APPEARANCE + 382 unknown + P_APPEARANCE.
            long guildCard = start + 96 + Constants.HunterAppearanceStructureSize + 382 + Constants.PalicoAppearanceStructureSize;
            long weaponUsage = guildCard + 171 + Constants.HunterAppearanceStructureSize + 212 + 64 + 4 + 194;

            // Inside the 194 "unknown" bytes before the weapon usage (layout from EnderHDMC/MHWISaveEditor's
            // SAVEDATA1000.bt, mhw_guild_card): ... u32 unity; u8 achievements[16]; u16 quests_lr, quests_hr,
            // investigations, quests_arena, quests_mr, quests_guiding_lands; u8 unknown5[12];
            // u32 guiding_lands_levels[6]; u8 unknown6[76]; then the weapon usage. Checked against a real save:
            // the bitfield equals the Steam achievement list and the counters equal the slot's own
            // "completed quests" block near the end of the slot.
            long questCounts = weaponUsage - 76 - 24 - 12 - 6 * 2;
            // Quest counters: read from the slot's "completed" block (template mhw_save_quests, slot +2008323:
            // u32 investigations, arena, ?, ?, ?, high_rank, low_rank, ?, master_rank, guiding_lands). In two saves its
            // values equalled the guild card's u16 counters at questCounts; the slot block is preferred because the
            // guild card copy proved stale for achievements.
            Seek(start + CompletedQuests);
            var c = new uint[10];
            for (int q = 0; q < 10; q++) c[q] = reader.ReadUInt32();
            uint[] picked = { c[6], c[5], c[0], c[1], c[8], c[9] }; // LR, HR, investigations, arena, MR, guiding lands
            for (int q = 0; q < 6; q++) slot.QuestCounts[q] = (ushort)Math.Min(picked[q], ushort.MaxValue);

            // Achievements: the slot's own "achievements_obtained" bitfield (template mhw_save_slot, slot +2008287).
            // The guild card copy (questCounts - 16) is NOT reliable: in a later save of the same hunter it only held
            // the 44 base-game achievements while this field still equalled the 80 Steam achievements bit for bit.
            Seek(start + AchievementsObtained);
            slot.Achievements = reader.ReadBytes(16);

            Seek(weaponUsage);
            slot.LowRank = WeaponUsage.Read(reader);
            slot.HighRank = WeaponUsage.Read(reader);
            slot.Investigations = WeaponUsage.Read(reader);
            slot.MasterRank = WeaponUsage.Read(reader);
            slot.GuidingLands = WeaponUsage.Read(reader);

            long monsters = weaponUsage + Constants.WeaponUsageStructureSize * 5 + 4 + 512 + 5454;
            Seek(monsters);
            slot.Captured = Read16();
            slot.Slayed = Read16();
            slot.Largest = Read16();
            slot.Smallest = Read16();
            slot.ResearchLevel = reader.ReadBytes(MonsterStatsReader.MaxMonsterCount);

            ReadDecorations(slot, start);
            return slot;
        }

        private ushort[] Read16()
        {
            var r = new ushort[MonsterStatsReader.MaxMonsterCount];
            for (int i = 0; i < r.Length; i++) r[i] = reader.ReadUInt16();
            return r;
        }

        private void AddSlotted(SlotData slot, uint equipmentId)
        {
            if (equipmentId == uint.MaxValue) return;
            if (jewelItemByEquipmentId.TryGetValue(equipmentId, out uint itemId))
                Inc(slot.Decorations, itemId);
            else
                Inc(slot.UnknownSlottedJewels, equipmentId);
        }

        private static void IncPair(Dictionary<(uint, uint), uint> d, (uint, uint) k) => d[k] = (d.TryGetValue(k, out var v) ? v : 0) + 1;

        private static void Inc(Dictionary<uint, uint> d, uint k, uint n = 1) => d[k] = (d.TryGetValue(k, out var v) ? v : 0) + n;

        private void ReadDecorations(SlotData slot, long start)
        {
            long pos = start + 96 + Constants.HunterAppearanceStructureSize + 382 + Constants.PalicoAppearanceStructureSize
                + Constants.GuildCardStructureSize * 101 // hunter's own + 100 shared
                + 209_447 // unknown
                + 142_200 // item loadouts
                + (24 * 8 + 16 * 8 + 256 + 7 * 8) // item pouch
                + (200 * 8 + 200 * 8 + 1250 * 8); // item box: items, ammo, materials
            Seek(pos);

            for (int i = 0; i < 500; i++) // decorations box
            {
                uint itemId = reader.ReadUInt32();
                uint qty = reader.ReadUInt32();
                if (itemId > 0 && qty > 0) Inc(slot.Decorations, itemId, qty);
            }

            for (int i = 0; i < 2500; i++) // equipment box (126 bytes each)
            {
                Skip(4); // sort index
                var type = (EquipmentType)reader.ReadUInt32();
                uint subType = reader.ReadUInt32(); // armor piece type / weapon type (MHWSaveUtils EquipmentReader)
                uint classId = reader.ReadUInt32(); // armor: master data setGroup; weapon: sortOrder
                Skip(4 + 4); // level, points
                uint d1 = reader.ReadUInt32(), d2 = reader.ReadUInt32(), d3 = reader.ReadUInt32();
                if (type == EquipmentType.Armor || type == EquipmentType.Weapon)
                {
                    AddSlotted(slot, d1); AddSlotted(slot, d2); AddSlotted(slot, d3);
                    if (type == EquipmentType.Armor && subType <= 4)
                        IncPair(slot.Armor, (subType, classId));
                    else if (type == EquipmentType.Weapon && subType <= 13)
                        IncPair(slot.Weapons, (subType, classId));
                }
                else if (type == EquipmentType.Charm)
                {
                    IncPair(slot.Charms, (0, classId));
                }
                Skip(90);
            }

            Skip(0x4AD29); // until specialized tools
            for (int i = 0; i < 128; i++) // specialized tools (126 bytes each)
            {
                Skip(4);
                uint available = reader.ReadUInt32();
                if (available == 0) { Skip(118); continue; }
                Skip(4);
                uint d1 = reader.ReadUInt32(), d2 = reader.ReadUInt32(), d3 = reader.ReadUInt32();
                AddSlotted(slot, d1); AddSlotted(slot, d2); AddSlotted(slot, d3);
                Skip(102);
            }
            Skip(0x539EF);

            if (reader.BaseStream.Position != start + SlotSize)
                throw new FormatException($"Slot layout mismatch: ended at {reader.BaseStream.Position}, expected {start + SlotSize}");
        }
    }
}
