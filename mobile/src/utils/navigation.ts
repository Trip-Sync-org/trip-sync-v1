export function safeGoBack(
  navigation: any,
  fallback: string = "Login",
) {
  if (navigation.canGoBack()) {
    navigation.goBack();
  } else {
    navigation.replace(fallback);
  }
}
