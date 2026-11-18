using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;

namespace MhwSaveReader
{
    /// <summary>
    /// Extra sections read straight from the decrypted bytes of one slot. Offsets are relative to the slot start and
    /// were computed from EnderHDMC/MHWISaveEditor's SAVEDATA1000.bt (commit 31ed450; knowledge only, no code copied):
    /// the template's struct sizes add up to exactly 2,136,768 bytes per slot and 11,284,704 bytes per file, and the
    /// equipment box / guild card offsets agree with MHWSaveUtils. Only fields checked against a real save are read
    /// (see THIRD_PARTY/README.md and research/save_format/).
    /// </summary>
    public static class SlotExtras
    {
        // mhw_save_slot field offsets (slot-relative)
        private const int Hunter = 4;                 // mhw_hunter
        private const int GuildCard = 690;            // mhw_guild_card
        private const int CurrentEquipment = 943637;  // i32 box index x10
        private const int MonstersCaptured128 = 944149, MonstersSlain128 = 944661; // u32[128]
        private const int EquipmentBox = 1156656;     // mhw_equipment[2500], 126 bytes
        private const int PalicoName = 1757139, PalicoXp = 1757203, PalicoGadgets = 1757207; // str64, u32, u32 x6
        private const int QuestsCleared = 1757671;    // u8[64], indexed by questNoList order (see quest_order.json)
        private const int Investigations = 1758687;   // mhw_investigation[400], 42 bytes
        private const int EquipmentLoadouts = 1796437; // mhw_equipment_loadout[224], 676 bytes
        private const int GuidingLands = 2123887;     // mhw_guiding_lands

        private const int EquipmentSize = 126, LoadoutSize = 676, InvestigationSize = 42;

        private static readonly string[] Gadgets =
            { "vigorwasp_spray", "flashfly_cage", "shieldspire", "coral_orchestra", "plunderblade", "meowlotov_cocktail" };
        private static readonly string[] LoadoutSlots = { "weapon", "head", "chest", "arms", "waist", "legs", "charm" };

        private static uint U32(byte[] d, long o) => BitConverter.ToUInt32(d, (int)o);
        private static int I32(byte[] d, long o) => BitConverter.ToInt32(d, (int)o);
        private static ulong U64(byte[] d, long o) => BitConverter.ToUInt64(d, (int)o);

        private static string Str(byte[] d, long o, int len)
        {
            int n = Array.IndexOf(d, (byte)0, (int)o, len);
            int end = n < 0 ? (int)o + len : n;
            return Encoding.UTF8.GetString(d, (int)o, end - (int)o);
        }

        private static Dictionary<int, string>? monsters128;
        private static List<uint>? questOrder;

        private static JsonDocument Resource(string name)
        {
            var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
                ?? throw new InvalidOperationException($"embedded {name} missing");
            return JsonDocument.Parse(s);
        }

        private static Dictionary<int, string> Monsters128()
        {
            if (monsters128 != null) return monsters128;
            using var doc = Resource("monsters128.json");
            monsters128 = doc.RootElement.GetProperty("monsters").EnumerateArray()
                .ToDictionary(e => e[0].GetInt32(), e => e[1].GetString() ?? "");
            return monsters128;
        }

        private static List<uint> QuestOrder()
        {
            if (questOrder != null) return questOrder;
            using var doc = Resource("quest_order.json");
            questOrder = doc.RootElement.GetProperty("ids").EnumerateArray().Select(e => e.GetUInt32()).ToList();
            return questOrder;
        }

        public static void Write(Utf8JsonWriter w, byte[] d, long s, EquipmentTable eq, IReadOnlyDictionary<uint, uint> jewelItemByEquipmentId)
        {
            WriteHunter(w, d, s);
            WriteGuildCard(w, d, s);
            WritePalico(w, d, s);
            WriteGuidingLands(w, d, s);
            WriteInvestigations(w, d, s);
            WriteMonsterLog(w, d, s);
            WriteQuests(w, d, s);
            WriteGear(w, d, s, eq, jewelItemByEquipmentId);
        }

        private static void WriteHunter(Utf8JsonWriter w, byte[] d, long s)
        {
            long h = s + Hunter;
            w.WriteStartObject("hunter");
            w.WriteString("name", Str(d, h, 64));
            w.WriteNumber("hr", U32(d, h + 64));
            w.WriteNumber("mr", U32(d, h + 68));
            w.WriteNumber("zenny", U32(d, h + 72));
            w.WriteNumber("research_points", U32(d, h + 76));
            w.WriteNumber("hr_xp", U32(d, h + 80));
            w.WriteNumber("mr_xp", U32(d, h + 84));
            w.WriteNumber("playtime_seconds", U32(d, h + 88));
            w.WriteEndObject();
        }

        private static void WriteGuildCard(Utf8JsonWriter w, byte[] d, long s)
        {
            long g = s + GuildCard;
            w.WriteStartObject("guild_card");
            ulong created = U64(d, g + 8);
            if (created > 0 && created < 4102444800UL)
                w.WriteString("created_at", DateTimeOffset.FromUnixTimeSeconds((long)created).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"));
            else
                w.WriteNull("created_at");
            w.WriteString("squad", Str(d, g + 101, 54));
            w.WriteString("title", Str(d, g + 1213, 256));
            w.WriteString("greeting", Str(d, g + 957, 256));
            w.WriteEndObject();
        }

        private static void WritePalico(Utf8JsonWriter w, byte[] d, long s)
        {
            w.WriteStartObject("palico");
            w.WriteString("name", Str(d, s + PalicoName, 64));
            w.WriteNumber("xp", U32(d, s + PalicoXp));
            w.WriteStartObject("gadget_xp");
            for (int i = 0; i < Gadgets.Length; i++) w.WriteNumber(Gadgets[i], U32(d, s + PalicoGadgets + 4 * i));
            w.WriteEndObject();
            w.WriteEndObject();
        }

        private static void WriteGuidingLands(Utf8JsonWriter w, byte[] d, long s)
        {
            long gl = s + GuidingLands;
            w.WriteStartObject("guiding_lands");
            w.WriteString("note", "regions by in-save index; level = region_level_unlocked, points = region_levels");
            w.WriteStartArray("regions");
            int max = 0;
            for (int i = 0; i < 6; i++)
            {
                int level = d[gl + 216 + i];
                max = Math.Max(max, level);
                w.WriteStartObject();
                w.WriteNumber("index", i);
                w.WriteNumber("level", level);
                w.WriteNumber("points", U32(d, gl + 4 + 4 * i));
                w.WriteEndObject();
            }
            w.WriteEndArray();
            w.WriteNumber("max_level", max);
            w.WriteEndObject();
        }

        private static void WriteInvestigations(Utf8JsonWriter w, byte[] d, long s)
        {
            var names = Monsters128();
            var byMonster = new Dictionary<int, int>();
            int count = 0, tempered = 0;
            for (int i = 0; i < 400; i++)
            {
                long o = s + Investigations + InvestigationSize * i;
                if (U32(d, o) != 30000 || I32(d, o + 15) < 0) continue; // 0x7530 = slot in use
                count++;
                bool anyTempered = false;
                for (int m = 0; m < 3; m++)
                {
                    int mon = I32(d, o + 15 + 4 * m);
                    if (mon >= 0) byMonster[mon] = (byMonster.TryGetValue(mon, out var c) ? c : 0) + 1;
                    if (d[o + 27 + m] != 0) anyTempered = true;
                }
                if (anyTempered) tempered++;
            }
            w.WriteStartObject("investigations");
            w.WriteNumber("count", count);
            w.WriteNumber("with_tempered", tempered);
            w.WriteStartArray("by_monster");
            foreach (var kv in byMonster.OrderByDescending(k => k.Value).ThenBy(k => k.Key))
            {
                w.WriteStartObject();
                w.WriteNumber("index", kv.Key);
                if (names.TryGetValue(kv.Key, out var n)) w.WriteString("name_en", n); else w.WriteNull("name_en");
                w.WriteNumber("count", kv.Value);
                w.WriteEndObject();
            }
            w.WriteEndArray();
            w.WriteEndObject();
        }

        private static void WriteMonsterLog(Utf8JsonWriter w, byte[] d, long s)
        {
            // Slot-level u32 counters for all 128 indices (includes small monsters, which the guild card omits).
            var names = Monsters128();
            w.WriteStartArray("monster_log");
            foreach (var kv in names.OrderBy(k => k.Key))
            {
                uint cap = U32(d, s + MonstersCaptured128 + 4 * kv.Key), slain = U32(d, s + MonstersSlain128 + 4 * kv.Key);
                if (cap == 0 && slain == 0) continue;
                w.WriteStartObject();
                w.WriteNumber("index", kv.Key);
                w.WriteString("name_en", kv.Value);
                w.WriteNumber("captured", cap);
                w.WriteNumber("slain", slain);
                w.WriteEndObject();
            }
            w.WriteEndArray();
        }

        private static void WriteQuests(Utf8JsonWriter w, byte[] d, long s)
        {
            var order = QuestOrder();
            w.WriteStartObject("quests");
            w.WriteString("semantics", "bit i of the slot's cleared-quest bitfield = i-th id of the game's questNoList (352 ids)");
            w.WriteStartArray("cleared");
            int n = 0;
            for (int i = 0; i < order.Count && i < 512; i++)
                if ((d[s + QuestsCleared + i / 8] >> (i % 8) & 1) != 0) { w.WriteNumberValue(order[i]); n++; }
            w.WriteEndArray();
            w.WriteNumber("cleared_count", n);
            w.WriteNumber("list_size", order.Count);
            w.WriteEndObject();
        }

        private static void WriteBoxRef(Utf8JsonWriter w, string name, byte[] d, long s, int index, EquipmentTable eq)
        {
            if (index < 0 || index >= 2500) { w.WriteNull(name); return; }
            long o = s + EquipmentBox + EquipmentSize * index;
            int cat = I32(d, o + 4);
            uint type = U32(d, o + 8), id = U32(d, o + 12);
            if (cat < 0) { w.WriteNull(name); return; }
            w.WriteStartObject(name);
            w.WriteNumber("box_index", index);
            eq.WriteRef(w, cat, type, id);
            w.WriteEndObject();
        }

        private static void WriteGear(Utf8JsonWriter w, byte[] d, long s, EquipmentTable eq, IReadOnlyDictionary<uint, uint> jewels)
        {
            w.WriteStartObject("gear");
            w.WriteStartObject("current");
            for (int i = 0; i < LoadoutSlots.Length; i++)
                WriteBoxRef(w, LoadoutSlots[i], d, s, I32(d, s + CurrentEquipment + 4 * i), eq);
            w.WriteEndObject();

            w.WriteStartArray("loadouts");
            for (int k = 0; k < 224; k++)
            {
                long o = s + EquipmentLoadouts + LoadoutSize * k;
                string name = Str(d, o + 4, 256);
                if (name.Length == 0) continue;
                w.WriteStartObject();
                w.WriteNumber("slot", U32(d, o));
                w.WriteString("name", name);
                for (int i = 0; i < LoadoutSlots.Length; i++)
                    WriteBoxRef(w, LoadoutSlots[i], d, s, I32(d, o + 260 + 4 * i), eq);
                w.WriteStartArray("tools");
                for (int t = 0; t < 2; t++) { int v = I32(d, o + 288 + 4 * t); if (v >= 0) w.WriteNumberValue(v); }
                w.WriteEndArray();
                w.WriteStartArray("decorations"); // jewel item ids slotted in weapon, armor, charm and the two tools
                for (int p = 0; p < 9; p++)
                    for (int q = 0; q < 3; q++)
                    {
                        uint e = U32(d, o + 296 + 12 * p + 4 * q);
                        if (e != uint.MaxValue && jewels.TryGetValue(e, out uint item)) w.WriteNumberValue(item);
                    }
                w.WriteEndArray();
                w.WriteEndObject();
            }
            w.WriteEndArray();
            w.WriteEndObject();
        }
    }
}
