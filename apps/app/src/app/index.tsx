import { StyleSheet, Text, View } from 'react-native'

// Placeholder until MVP-13 brings the real shell; proves the universal build on web and native.
export default function HomeScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Switch Time</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '600' },
})
