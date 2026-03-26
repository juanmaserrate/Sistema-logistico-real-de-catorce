export type RootStackParamList = {
  Login: undefined;
  Track: undefined;
  EmbeddedNav: {
    routeId: number;
    stopId: number;
    destLat: number;
    destLng: number;
    title: string;
  };
};
