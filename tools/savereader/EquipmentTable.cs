using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.Json;

namespace MhwSaveReader
{
    /// <summary>
    /// Names for the ids stored in the equipment box, from the embedded Data/equipment.json
    /// (derived from MHWMasterDataUtils; armor keyed by setGroup per piece type, weapons by sortOrder per weapon
    /// type, the same keys MHWSaveUtils' EquipmentReader uses). Ids missing from the table are still reported,
    /// with null names, so nothing owned is silently dropped.
    /// </summary>
    public sealed class EquipmentTable
    {
        public static readonly string[] ArmorTypes = { "head", "chest", "arms", "waist", "legs" };
        public static readonly string[] WeaponTypes =
        {
            "great_sword", "sword_and_shield", "dual_blades", "long_sword", "hammer", "hunting_horn", "lance",
            "gunlance", "switch_axe", "charge_blade", "insect_glaive", "bow", "heavy_bowgun", "light_bowgun",
        };

        private sealed record Entry(int Rarity, string NameEn, string? NameEs);

        private readonly Dictionary<(uint, uint), Entry> armor = new();
        private readonly Dictionary<(uint, uint), Entry> weapons = new();
        private readonly Dictionary<(uint, uint), Entry> charms = new();
        private string source = "";

        public static EquipmentTable Load()
        {
            using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("equipment.json")
                ?? throw new InvalidOperationException("embedded equipment.json missing");
            using var doc = JsonDocument.Parse(s);
            var t = new EquipmentTable { source = doc.RootElement.GetProperty("source").GetString() ?? "" };
            Fill(t.armor, doc.RootElement.GetProperty("armor"), ArmorTypes);
            Fill(t.weapons, doc.RootElement.GetProperty("weapons"), WeaponTypes);
            foreach (var r in doc.RootElement.GetProperty("charms").EnumerateArray())
                t.charms[(0, r[0].GetUInt32())] = new Entry(r[1].GetInt32(), r[2].GetString() ?? "",
                    r[3].ValueKind == JsonValueKind.String ? r[3].GetString() : null);
            return t;
        }

        private static void Fill(Dictionary<(uint, uint), Entry> d, JsonElement byType, string[] types)
        {
            for (uint ti = 0; ti < types.Length; ti++)
                foreach (var r in byType.GetProperty(types[ti]).EnumerateArray())
                    d[(ti, r[0].GetUInt32())] = new Entry(r[1].GetInt32(), r[2].GetString() ?? "",
                        r[3].ValueKind == JsonValueKind.String ? r[3].GetString() : null);
        }

        public void Write(Utf8JsonWriter w, SlotData s)
        {
            w.WriteStartObject("equipment");
            w.WriteString("semantics", "pieces currently in the equipment box (sold or melted pieces are not listed)");
            w.WriteString("names_source", source);
            WriteList(w, "armor", s.Armor, armor, ArmorTypes);
            WriteList(w, "weapons", s.Weapons, weapons, WeaponTypes);
            WriteList(w, "charms", s.Charms, charms, new[] { "charm" });
            w.WriteEndObject();
        }

        /// <summary>Category/type/id/names of one equipment-box entry (category: 0 armor, 1 weapon, 2 charm, 4 kinsect).</summary>
        public void WriteRef(Utf8JsonWriter w, int category, uint type, uint id)
        {
            Dictionary<(uint, uint), Entry>? table = null;
            string? typeName = null, cat;
            switch (category)
            {
                case 0: cat = "armor"; if (type < ArmorTypes.Length) { table = armor; typeName = ArmorTypes[type]; } break;
                case 1: cat = "weapon"; if (type < WeaponTypes.Length) { table = weapons; typeName = WeaponTypes[type]; } break;
                case 2: cat = "charm"; table = charms; typeName = "charm"; type = 0; break;
                case 4: cat = "kinsect"; break;
                default: cat = "other"; break;
            }
            w.WriteString("category", cat);
            if (typeName != null) w.WriteString("type", typeName); else w.WriteNull("type");
            w.WriteNumber("id", id);
            if (table != null && table.TryGetValue((type, id), out var e))
            {
                w.WriteString("name_en", e.NameEn);
                if (e.NameEs != null) w.WriteString("name_es", e.NameEs); else w.WriteNull("name_es");
            }
            else
            {
                w.WriteNull("name_en");
                w.WriteNull("name_es");
            }
        }

        private static void WriteList(Utf8JsonWriter w, string name, Dictionary<(uint Type, uint Id), uint> owned,
            Dictionary<(uint, uint), Entry> table, string[] types)
        {
            w.WriteStartArray(name);
            foreach (var kv in owned.OrderBy(k => k.Key.Type).ThenBy(k => k.Key.Id))
            {
                w.WriteStartObject();
                w.WriteString("type", types[kv.Key.Type]);
                w.WriteNumber("id", kv.Key.Id);
                if (table.TryGetValue(kv.Key, out var e))
                {
                    w.WriteString("name_en", e.NameEn);
                    if (e.NameEs != null) w.WriteString("name_es", e.NameEs); else w.WriteNull("name_es");
                    if (e.Rarity > 0) w.WriteNumber("rarity", e.Rarity); else w.WriteNull("rarity");
                }
                else
                {
                    w.WriteNull("name_en");
                    w.WriteNull("name_es");
                    w.WriteNull("rarity");
                }
                w.WriteNumber("count", kv.Value);
                w.WriteEndObject();
            }
            w.WriteEndArray();
        }
    }
}
