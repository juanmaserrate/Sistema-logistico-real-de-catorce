import React from 'react';
import { FlatList, View } from 'react-native';

const DraggableFlatList = ({ data, renderItem, keyExtractor, ...rest }) => (
  <FlatList
    data={data}
    renderItem={(info) => renderItem({ ...info, drag: () => {}, isActive: false })}
    keyExtractor={keyExtractor}
    {...rest}
  />
);

export const ScaleDecorator = ({ children }) => <View>{children}</View>;
export default DraggableFlatList;
