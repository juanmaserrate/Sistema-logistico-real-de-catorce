import React from 'react';
import { View, Text } from 'react-native';

const MapView = React.forwardRef(({ style, children }, ref) => (
  <View ref={ref} style={[{ backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center', minHeight: 300 }, style]}>
    <Text style={{ color: '#6b7280', fontSize: 16 }}>Mapa (solo disponible en dispositivo)</Text>
    {children}
  </View>
));
MapView.displayName = 'MapView';

const Marker = ({ children }) => null;
const Polyline = () => null;
const PROVIDER_GOOGLE = 'google';

export default MapView;
export { Marker, Polyline, PROVIDER_GOOGLE };
