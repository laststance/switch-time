import 'react-native'

// react-native-web forwards onKeyDown to the DOM node (its KeyboardEvent props API); the core types do not declare it and native ignores it.
declare module 'react-native' {
  interface PressableProps {
    onKeyDown?: (event: {
      nativeEvent: { key: string }
      preventDefault(): void
    }) => void
  }
}
