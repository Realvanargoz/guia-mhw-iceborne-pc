using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using MHWSaveUtils;

namespace MhwSaveReader
{
    /// <summary>
    /// mhw-savereader &lt;path&gt; [--json]
    /// Read-only: the file is opened for reading, loaded into memory and decrypted there. Nothing is ever written.
    /// Exit codes: 0 ok, 1 usage, 2 unreadable / truncated / bad signature.
    /// </summary>
    public static class Program
    {
        public const int FormatVersion = 1;

        // Last byte touched by the decryption: the Iceborne layer reads a 0x200-byte salt after the last region.
        private const long MinimumLength = 0x714658 + 0x2098C0 + 0x200;
        private const long MaximumLength = 64L * 1024 * 1024;

        public static int Main(string[] args)
        {
            // Research aid: --dump <file> writes the decrypted copy (in-memory decrypt of the COPY) for offline analysis.
            string? dumpPath = null;
            var argList = args.ToList();
            int di = argList.IndexOf("--dump");
            if (di >= 0 && di + 1 < argList.Count) { dumpPath = argList[di + 1]; argList.RemoveRange(di, 2); }
            var positional = argList.Where(a => !a.StartsWith("--", StringComparison.Ordinal)).ToList();
            var unknown = argList.Where(a => a.StartsWith("--", StringComparison.Ordinal) && a != "--json").ToList();
            if (positional.Count != 1 || unknown.Count > 0)
            {
                Console.Error.WriteLine("usage: mhw-savereader <path-to-SAVEDATA1000-copy> [--json]");
                return 1;
            }

            try
            {
                byte[] data = LoadAndDecrypt(positional[0]);
                if (dumpPath != null) { File.WriteAllBytes(dumpPath, data); return 0; }
                var jewels = LoadJewels();
                var byEquip = jewels.ToDictionary(j => j.EquipmentId, j => j.ItemId);
                List<SlotData> slots;
                using (var ms = new MemoryStream(data, writable: false))
                using (var reader = new SlotReader(ms, byEquip))
                    slots = reader.Read().ToList();

                var equipment = EquipmentTable.Load();
                var opts = new JsonWriterOptions { Indented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
                using var stdout = Console.OpenStandardOutput();
                using (var w = new Utf8JsonWriter(stdout, opts))
                    Write(w, slots, jewels.ToDictionary(j => j.ItemId), equipment, data, byEquip);
                stdout.WriteByte((byte)'\n');
                return 0;
            }
            catch (Exception ex)
            {
                var kind = ex switch
                {
                    FileNotFoundException or DirectoryNotFoundException => "not_found",
                    EndOfStreamException => "truncated",
                    FormatException => "bad_format",
                    UnauthorizedAccessException or IOException => "io_error",
                    _ => "error",
                };
                var err = JsonSerializer.Serialize(new Dictionary<string, object>
                {
                    ["format"] = FormatVersion,
                    ["error"] = kind,
                    ["message"] = ex.Message,
                });
                Console.Error.WriteLine(err);
                return 2;
            }
        }

        private static byte[] LoadAndDecrypt(string path)
        {
            byte[] data;
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                if (fs.Length > MaximumLength)
                    throw new FormatException($"File is too large to be a save ({fs.Length} bytes)");
                if (fs.Length < MinimumLength)
                    throw new EndOfStreamException($"File is truncated ({fs.Length} bytes, need at least {MinimumLength})");
                if (fs.Length % 8 != 0)
                    throw new EndOfStreamException($"File length {fs.Length} is not a multiple of 8 (incomplete copy?)");
                data = new byte[fs.Length];
                fs.ReadExactly(data);
            }

            new MHWCrypto.Crypto().Decrypt(data); // in memory only
            return data;
        }

        private sealed record Jewel(uint EquipmentId, uint ItemId, string NameEn, string? NameEs);

        private static List<Jewel> LoadJewels()
        {
            using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("jewels.json")
                ?? throw new InvalidOperationException("embedded jewels.json missing");
            using var doc = JsonDocument.Parse(s);
            return doc.RootElement.EnumerateArray().Select(e => new Jewel(
                e.GetProperty("equipment_id").GetUInt32(),
                e.GetProperty("item_id").GetUInt32(),
                e.GetProperty("name_en").GetString() ?? "",
                e.TryGetProperty("name_es", out var es) ? es.GetString() : null)).ToList();
        }

        private static void Write(Utf8JsonWriter w, List<SlotData> slots, Dictionary<uint, Jewel> jewelsByItem, EquipmentTable equipment,
            byte[] data, IReadOnlyDictionary<uint, uint> jewelItemByEquipmentId)
        {
            w.WriteStartObject();
            w.WriteNumber("format", FormatVersion);
            w.WriteBoolean("signature_ok", true);
            w.WriteString("hunted_semantics", "hunted = slayed + captured (in-game 'Hunted (Captured)'); slayed is reported separately");
            w.WriteStartArray("slots");
            foreach (var s in slots)
            {
                w.WriteStartObject();
                w.WriteNumber("slot", s.SlotNumber);
                w.WriteString("name", s.Name);
                w.WriteNumber("hr", s.HR);
                w.WriteNumber("mr", s.MR);
                w.WriteNumber("zenny", s.Zeni);
                w.WriteNumber("research_points", s.ResearchPoints);
                w.WriteNumber("playtime_seconds", s.Playtime);

                w.WriteStartArray("monsters");
                for (int i = 0; i < MonsterStatsReader.MaxMonsterCount; i++)
                {
                    MonsterTable.ByIndex.TryGetValue(i, out var info);
                    bool any = s.Captured[i] != 0 || s.Slayed[i] != 0 || s.Largest[i] != 0 || s.Smallest[i] != 0 || s.ResearchLevel[i] != 0;
                    if (info == null && !any) continue; // unused index

                    w.WriteStartObject();
                    w.WriteNumber("index", i);
                    if (info != null) w.WriteString("name_en", info.NameEn); else w.WriteNull("name_en");
                    w.WriteNumber("hunted", s.Slayed[i] + s.Captured[i]);
                    w.WriteNumber("slayed", s.Slayed[i]);
                    w.WriteNumber("captured", s.Captured[i]);
                    WriteNullableNumber(w, "largest_pct", s.Largest[i]);
                    WriteNullableNumber(w, "smallest_pct", s.Smallest[i]);
                    w.WriteNumber("research_level", s.ResearchLevel[i]);
                    if (info?.BaseSize is double bs)
                    {
                        w.WriteNumber("base_size", bs);
                        WriteSize(w, "largest_size", s.Largest[i], bs);
                        WriteSize(w, "smallest_size", s.Smallest[i], bs);
                    }
                    else
                    {
                        w.WriteNull("base_size");
                    }

                    if (info?.Crown is CrownPreset c)
                    {
                        bool gold = s.Largest[i] != 0 && s.Largest[i] >= c.Gold;
                        w.WriteStartObject("crown");
                        w.WriteString("preset", c.Name);
                        w.WriteBoolean("mini", s.Smallest[i] != 0 && s.Smallest[i] <= c.Mini);
                        w.WriteBoolean("silver", gold || (s.Largest[i] != 0 && s.Largest[i] >= c.Silver));
                        w.WriteBoolean("gold", gold);
                        w.WriteEndObject();
                    }
                    else
                    {
                        w.WriteNull("crown");
                    }
                    w.WriteEndObject();
                }
                w.WriteEndArray();

                w.WriteStartObject("weapon_usage");
                WriteUsage(w, "low_rank", s.LowRank);
                WriteUsage(w, "high_rank", s.HighRank);
                WriteUsage(w, "master_rank", s.MasterRank);
                WriteUsage(w, "investigations", s.Investigations);
                WriteUsage(w, "guiding_lands", s.GuidingLands);
                WriteUsage(w, "total", s.LowRank + s.HighRank + s.MasterRank + s.Investigations + s.GuidingLands);
                w.WriteEndObject();

                w.WriteStartArray("decorations");
                foreach (var kv in s.Decorations.OrderBy(k => k.Key))
                {
                    w.WriteStartObject();
                    w.WriteNumber("item_id", kv.Key);
                    if (jewelsByItem.TryGetValue(kv.Key, out var j))
                    {
                        w.WriteString("name_en", j.NameEn);
                        if (j.NameEs != null) w.WriteString("name_es", j.NameEs); else w.WriteNull("name_es");
                    }
                    else
                    {
                        w.WriteNull("name_en");
                        w.WriteNull("name_es");
                    }
                    w.WriteNumber("count", kv.Value);
                    w.WriteEndObject();
                }
                w.WriteEndArray();
                if (s.UnknownSlottedJewels.Count > 0)
                {
                    w.WriteStartObject("unknown_slotted_jewels");
                    foreach (var kv in s.UnknownSlottedJewels.OrderBy(k => k.Key))
                        w.WriteNumber(kv.Key.ToString(System.Globalization.CultureInfo.InvariantCulture), kv.Value);
                    w.WriteEndObject();
                }

                w.WriteStartObject("quest_counts"); // guild card counters (cleared quests per category)
                w.WriteNumber("low_rank", s.QuestCounts[0]);
                w.WriteNumber("high_rank", s.QuestCounts[1]);
                w.WriteNumber("investigations", s.QuestCounts[2]);
                w.WriteNumber("arena", s.QuestCounts[3]);
                w.WriteNumber("master_rank", s.QuestCounts[4]);
                w.WriteNumber("guiding_lands", s.QuestCounts[5]);
                w.WriteEndObject();

                w.WriteStartArray("achievements_unlocked"); // bit N of the slot achievement bitfield = Steam "AchievementN"
                for (int b = 0; b < s.Achievements.Length * 8; b++)
                    if ((s.Achievements[b / 8] >> (b % 8) & 1) != 0) w.WriteNumberValue(b);
                w.WriteEndArray();

                equipment.Write(w, s);
                SlotExtras.Write(w, data, s.Start, equipment, jewelItemByEquipmentId);

                w.WriteEndObject();
            }
            w.WriteEndArray();
            w.WriteEndObject();
        }

        private static void WriteNullableNumber(Utf8JsonWriter w, string name, ushort v)
        {
            if (v == 0) w.WriteNull(name); else w.WriteNumber(name, v);
        }

        private static void WriteSize(Utf8JsonWriter w, string name, ushort pct, double baseSize)
        {
            if (pct == 0) w.WriteNull(name); else w.WriteNumber(name, Math.Round(baseSize * pct / 100.0, 2));
        }

        private static void WriteUsage(Utf8JsonWriter w, string name, WeaponUsage u)
        {
            w.WriteStartObject(name);
            w.WriteNumber("great_sword", u.GreatSword);
            w.WriteNumber("long_sword", u.LongSword);
            w.WriteNumber("sword_and_shield", u.SwordAndShield);
            w.WriteNumber("dual_blades", u.DualBlades);
            w.WriteNumber("hammer", u.Hammer);
            w.WriteNumber("hunting_horn", u.HuntingHorn);
            w.WriteNumber("lance", u.Lance);
            w.WriteNumber("gunlance", u.Gunlance);
            w.WriteNumber("switch_axe", u.SwitchAxe);
            w.WriteNumber("charge_blade", u.ChargeBlade);
            w.WriteNumber("insect_glaive", u.InsectGlaive);
            w.WriteNumber("light_bowgun", u.LightBowgun);
            w.WriteNumber("heavy_bowgun", u.HeavyBowgun);
            w.WriteNumber("bow", u.Bow);
            w.WriteEndObject();
        }
    }
}
