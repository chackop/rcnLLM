import { useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
// expo/fetch supports streaming response bodies (RN's built-in fetch does not).
import { fetch } from "expo/fetch";

// On a real device use your machine's LAN IP, e.g. http://192.168.1.20:3001
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

type Message = { id: string; role: "user" | "assistant"; content: string };

// Minimal SSE parser: splits on blank lines, reads `event:` and `data:`.
function parseSSE(buffer: string) {
  const events: { event: string; data: any }[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? ""; // incomplete trailing event stays buffered
  for (const part of parts) {
    let event = "message";
    let data = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (data) events.push({ event, data: JSON.parse(data) });
  }
  return { events, rest };
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const patchLast = (fn: (m: Message) => Message) =>
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const history = [...messages, { id: `u${Date.now()}`, role: "user" as const, content: text }];
    setMessages([...history, { id: `a${Date.now()}`, role: "assistant", content: "" }]);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSSE(buffer);
        buffer = rest;
        for (const ev of events) {
          if (ev.event === "token") {
            patchLast((m) => ({ ...m, content: m.content + ev.data.text }));
          } else if (ev.event === "error") {
            throw new Error(ev.data.message);
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        patchLast((m) => ({ ...m, content: m.content || `⚠️ ${e?.message ?? "Something went wrong"}` }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === "user" ? styles.user : styles.assistant]}>
              <Text style={item.role === "user" ? styles.userText : styles.assistantText}>
                {item.content || "…"}
              </Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Ask me anything.</Text>}
        />
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Message"
            onSubmitEditing={send}
            editable={!busy}
          />
          <Pressable
            style={[styles.button, busy && styles.stop]}
            onPress={busy ? () => abortRef.current?.abort() : send}
          >
            <Text style={styles.buttonText}>{busy ? "Stop" : "Send"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { textAlign: "center", color: "#888", marginTop: 80 },
  bubble: { maxWidth: "85%", padding: 12, borderRadius: 16 },
  user: { alignSelf: "flex-end", backgroundColor: "#111" },
  assistant: { alignSelf: "flex-start", backgroundColor: "#f0f0f0" },
  userText: { color: "#fff", fontSize: 16 },
  assistantText: { color: "#111", fontSize: 16 },
  composer: { flexDirection: "row", padding: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#ddd" },
  input: { flex: 1, backgroundColor: "#f5f5f5", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 16 },
  button: { backgroundColor: "#111", borderRadius: 20, paddingHorizontal: 18, justifyContent: "center" },
  stop: { backgroundColor: "#c0392b" },
  buttonText: { color: "#fff", fontWeight: "600" },
});
