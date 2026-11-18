// [savereader] Extracted from TanukiSharp/MHWSaveUtils@aad1e19aed2fd41158b2dd3e3bb8582ffb4df1a8 MHWSaveUtils/FileSystemUtils.cs.
// Only the SaveDataInfo struct is kept; FileSystemUtils (Win32 registry lookup) and SaveDataFileMonitor (file watcher) are dropped.
using System;

namespace MHWSaveUtils
{
    public struct SaveDataInfo
    {
        public string UserId { get; }
        public string SaveDataFullFilename { get; }

        public SaveDataInfo(string userId, string saveDataFullFilename)
        {
            if (userId == null)
                throw new ArgumentNullException(nameof(userId));
            if (string.IsNullOrWhiteSpace(userId))
                throw new ArgumentException($"Argument '{nameof(userId)}' must not be empty.");
            if (saveDataFullFilename == null)
                throw new ArgumentNullException(nameof(saveDataFullFilename));
            if (string.IsNullOrWhiteSpace(saveDataFullFilename))
                throw new ArgumentException($"Argument '{nameof(saveDataFullFilename)}' must not be empty.");

            UserId = userId;
            SaveDataFullFilename = saveDataFullFilename;
        }

        public bool IsEmpty
        {
            get
            {
                return UserId == null;
            }
        }

        public override bool Equals(object obj)
        {
            if (obj is SaveDataInfo data)
                return data.UserId == UserId && data.SaveDataFullFilename == SaveDataFullFilename;
            return false;
        }

        public override int GetHashCode()
        {
            return $"{UserId};{SaveDataFullFilename}".GetHashCode();
        }

        public static bool operator ==(SaveDataInfo left, SaveDataInfo right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(SaveDataInfo left, SaveDataInfo right)
        {
            return !(left == right);
        }
    }
}
