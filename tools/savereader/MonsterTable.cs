using System.Collections.Generic;

namespace MhwSaveReader
{
    /// <summary>Crown thresholds, in percent of the base size, as stored in the save.</summary>
    public sealed record CrownPreset(string Name, int Mini, int Silver, int Gold);

    public sealed record MonsterInfo(int Index, string NameEn, double? BaseSize, CrownPreset? Crown);

    /// <summary>
    /// Index (position in the save's per-monster arrays) to monster.
    /// Indices 0-58, 60-65 and 69 come from MHWSaveUtils' MonsterStatsReader.MonsterData.
    /// The original reader enumerated that dictionary sequentially, which shifts every monster after the
    /// gap at index 59; here the dictionary key is used as the real index.
    /// Base-game base sizes and Standard/Alternate presets come from MHWSaveUtils; Iceborne base sizes and the
    /// Savage/Rajang presets come from SmartHunter's MonsterDataConfig (in-quest crown data).
    /// Indices 59, 66, 67, 68 and 70 come from the monsters96 order in EnderHDMC/MHWISaveEditor's SAVEDATA1000.bt
    /// (cross-checked against Fusion86/Cirilla misc/savedata.bt and a real save; see THIRD_PARTY/README.md).
    /// Indices 71-95 are unused; they are only emitted if the save ever has data there.
    /// </summary>
    public static class MonsterTable
    {
        public static readonly CrownPreset Standard = new("standard", 90, 115, 123);
        public static readonly CrownPreset Alternate = new("alternate", 90, 110, 120);
        public static readonly CrownPreset Savage = new("savage", 99, 114, 120);
        public static readonly CrownPreset Rajang = new("rajang", 90, 111, 118);

        private static MonsterInfo M(int i, string n, double? size, CrownPreset? c) => new(i, n, size, c);

        public static readonly IReadOnlyDictionary<int, MonsterInfo> ByIndex = Build(
            M(0, "Great Jagras", 1109.66, Standard),
            M(1, "Kulu-Ya-Ku", 901.24, Standard),
            M(2, "Pukei-Pukei", 1102.45, Alternate),
            M(3, "Barroth", 1383.07, Standard),
            M(4, "Jyuratodus", 1508.71, Standard),
            M(5, "Tobi-Kadachi", 1300.52, Alternate),
            M(6, "Anjanath", 1646.46, Alternate),
            M(7, "Rathian", 1754.37, Standard),
            M(8, "Tzitzi-Ya-Ku", 894.04, Standard),
            M(9, "Paolumu", 1143.36, Standard),
            M(10, "Great Girros", 1053.15, Standard),
            M(11, "Radobaan", 1803.47, Alternate),
            M(12, "Legiana", 1699.75, Standard),
            M(13, "Odogaron", 1388.75, Standard),
            M(14, "Rathalos", 1704.22, Standard),
            M(15, "Diablos", 2096.25, Standard),
            M(16, "Kirin", 536.26, Standard),
            M(17, "Zorah Magdaros", 25764.59, null),
            M(18, "Dodogama", 1111.11, Standard),
            M(19, "Pink Rathian", 1754.37, Standard),
            M(20, "Bazelgeuse", 1928.38, Standard),
            M(21, "Lavasioth", 1797.24, Standard),
            M(22, "Uragaan", 2058.63, Alternate),
            M(23, "Azure Rathalos", 1704.22, Standard),
            M(24, "Black Diablos", 2096.25, Standard),
            M(25, "Nergigante", 1848.12, Standard),
            M(26, "Teostra", 1790.15, Standard),
            M(27, "Kushala Daora", 1913.13, Standard),
            M(28, "Vaal Hazak", 2095.40, Standard),
            M(29, "Xeno'jiiva", 4509.10, null),
            M(30, "Deviljho", 2063.82, Alternate),
            M(31, "Kulve Taroth", 4573.25, null),
            M(32, "Lunastra", 1828.69, Standard),
            M(33, "Behemoth", 3423.65, null),
            M(34, "Leshen", 549.70, null),
            M(35, "Ancient Leshen", 633.81, null),
            M(36, "Beotodus", 1661.99, Standard),
            M(37, "Banbaro", 2404.84, Standard),
            M(38, "Viper Tobi-Kadachi", 1300.52, Alternate),
            M(39, "Nightshade Paolumu", 1143.36, Standard),
            M(40, "Coral Pukei-Pukei", 1102.45, Alternate),
            M(41, "Barioth", 2098.30, Standard),
            M(42, "Nargacuga", 1914.74, Standard),
            M(43, "Glavenus", 2461.50, Alternate),
            M(44, "Tigrex", 1943.20, Standard),
            M(45, "Brachydios", 1630.55, Standard),
            M(46, "Acidic Glavenus", 2372.44, Alternate),
            M(47, "Shrieking Legiana", 1831.69, Standard),
            M(48, "Fulgur Anjanath", 1646.46, Alternate),
            M(49, "Ebony Odogaron", 1388.75, Standard),
            M(50, "Velkhana", 2596.05, Standard),
            M(51, "Seething Bazelgeuse", 1928.38, Standard),
            M(52, "Blackveil Vaal Hazak", 2095.40, Standard),
            M(53, "Namielle", 2048.25, Standard),
            M(54, "Savage Deviljho", 2063.82, Savage),
            M(55, "Ruiner Nergigante", 1848.12, Standard),
            M(56, "Shara Ishvalda", 2910.91, null),
            M(57, "Zinogre", 1743.49, Standard),
            M(58, "Yian Garuga", 1389.01, Standard),
            M(59, "Scarred Yian Garuga", 1389.01, Standard),
            M(60, "Brute Tigrex", 1943.20, Standard),
            M(61, "Gold Rathian", 1754.37, Standard),
            M(62, "Silver Rathalos", 1704.22, Standard),
            M(63, "Rajang", 829.11, Rajang),
            M(64, "Stygian Zinogre", 1743.49, Standard),
            M(65, "Safi'jiiva", 4799.78, Standard),
            M(66, "Furious Rajang", 829.11, Rajang),
            M(67, "Raging Brachydios", 2282.77, null), // fixed size: the save records no largest/smallest
            M(68, "Frostfang Barioth", 2098.30, null), // crown preset not documented by SmartHunter
            M(69, "Alatreon", 2969.63, null),
            M(70, "Fatalis", 4137.17, null)
        );

        private static IReadOnlyDictionary<int, MonsterInfo> Build(params MonsterInfo[] items)
        {
            var d = new Dictionary<int, MonsterInfo>();
            foreach (var m in items) d.Add(m.Index, m);
            return d;
        }
    }
}
