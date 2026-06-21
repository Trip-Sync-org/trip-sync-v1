import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Token cache for Clerk using AsyncStorage.
 * AsyncStorage is already installed and linked in this project.
 */
const tokenCache = {
  async getToken(key: string) {
    try {
      return AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};

export default tokenCache;