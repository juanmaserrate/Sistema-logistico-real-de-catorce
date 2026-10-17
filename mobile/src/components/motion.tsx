/* ============================================================================
 * MOTION — las micro-interacciones de la app del chofer
 * ============================================================================
 * Por que con el Animated que trae React Native y no con Reanimated: Animated
 * es JavaScript puro. Eso significa que estos cambios viajan por aire con
 * `eas update` y entran en el celular del chofer la proxima vez que abre la
 * app, sin bajar un APK nuevo. Una libreria nueva obligaria a reinstalar.
 *
 * Todo lo de aca usa useNativeDriver: true. No es un detalle: la animacion
 * corre en el hilo nativo y sigue fluida aunque el telefono este ocupado
 * mandando la posicion GPS. Por eso no se anima nunca `width` ni
 * `backgroundColor` (esos obligan a volver al hilo de JavaScript): para la
 * barra de progreso se estira con scaleX, y para pintar algo de verde se
 * prende una capa que ya esta puesta arriba.
 *
 * Si el chofer tiene activado "reducir animaciones" en Android, todo esto
 * queda quieto solo.
 * ========================================================================= */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

// ─── Preferencia del sistema ────────────────────────────────────────────────

let quieto = false;
const oyentes = new Set<(v: boolean) => void>();

AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => { quieto = !!v; oyentes.forEach((f) => f(quieto)); })
  .catch(() => { /* si no se puede preguntar, se anima */ });

AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => {
  quieto = !!v;
  oyentes.forEach((f) => f(quieto));
});

/** true cuando el telefono pide animaciones reducidas. */
export function useQuieto(): boolean {
  const [v, setV] = useState(quieto);
  useEffect(() => {
    oyentes.add(setV);
    return () => { oyentes.delete(setV); };
  }, []);
  return v;
}

// ─── Tiempos ────────────────────────────────────────────────────────────────
// Cortos a proposito. El chofer tiene el celular en una mano y el camion en
// la otra: una animacion de medio segundo deja de ser informacion y pasa a ser
// una espera.
const T = {
  toque: 90,
  entra: 260,
  destello: 900,
  numero: 500,
  barra: 420,
};

const SALIDA = Easing.bezier(0.2, 0.8, 0.3, 1);   // arranca rapido, frena suave

// ─── 1. El toque ────────────────────────────────────────────────────────────

/**
 * Hunde el boton mientras lo tienen apretado. Antes no pasaba absolutamente
 * nada al tocar: con guantes o con el sol de frente no habia forma de saber
 * si el toque habia entrado, y los choferes tocaban dos veces.
 *
 * Se usa asi:
 *   const toque = useToque();
 *   <Pressable {...toque.props}><Animated.View style={toque.estilo}>…
 */
export function useToque(escala = 0.96) {
  const v = useRef(new Animated.Value(1)).current;
  const sinMovimiento = useQuieto();

  const a = useCallback((hacia: number) => {
    if (sinMovimiento) return;
    Animated.timing(v, {
      toValue: hacia,
      duration: T.toque,
      easing: SALIDA,
      useNativeDriver: true,
    }).start();
  }, [v, sinMovimiento]);

  return useMemo(() => ({
    props: {
      onPressIn: () => a(escala),
      onPressOut: () => a(1),
    },
    estilo: { transform: [{ scale: v }] },
  }), [a, escala, v]);
}

/**
 * Un Pressable que se hunde al tocarlo. Es la forma de usarlo adentro de la
 * lista de paradas, donde no se pueden llamar hooks de a uno por boton.
 *
 * Acepta todo lo que acepta Pressable (onPress, disabled, hitSlop...).
 */
export function BotonToque({ children, style, escala = 0.96, ...resto }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  escala?: number;
} & Omit<PressableProps, 'style' | 'children'>) {
  const v = useRef(new Animated.Value(1)).current;
  const sinMovimiento = useQuieto();

  const a = useCallback((hacia: number) => {
    if (sinMovimiento) return;
    Animated.timing(v, {
      toValue: hacia, duration: T.toque, easing: SALIDA, useNativeDriver: true,
    }).start();
  }, [v, sinMovimiento]);

  return (
    <Animated.View style={{ transform: [{ scale: v }] }}>
      <Pressable
        {...resto}
        style={style as any}
        onPressIn={(e) => { a(escala); resto.onPressIn?.(e); }}
        onPressOut={(e) => { a(1); resto.onPressOut?.(e); }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

// ─── 2. Entrar en pantalla ──────────────────────────────────────────────────

/**
 * Aparece subiendo un poco. Con `retraso` escalonado, una lista de paradas
 * entra en cascada en vez de aparecer toda de golpe.
 */
export function Aparece({ children, retraso = 0, desde = 12, style }: {
  children: React.ReactNode; retraso?: number; desde?: number; style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const sinMovimiento = useQuieto();

  useEffect(() => {
    if (sinMovimiento) { v.setValue(1); return; }
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: T.entra,
      delay: retraso,
      easing: SALIDA,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [v, retraso, sinMovimiento]);

  return (
    <Animated.View style={[style, {
      opacity: v,
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [desde, 0] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

// ─── 3. El destello de "listo" ──────────────────────────────────────────────

/**
 * Pinta la tarjeta de verde un segundo cuando la parada pasa a entregada.
 * Es el momento mas importante del dia del chofer y hasta ahora no se
 * festejaba: la fila cambiaba de color y listo.
 *
 * `prendido` es la senal: cada vez que pasa de false a true, destella.
 */
export function Destello({ children, prendido, color = 'rgba(0,109,67,0.16)', radio = 16, style }: {
  children: React.ReactNode; prendido: boolean; color?: string; radio?: number; style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const anterior = useRef(prendido);
  const sinMovimiento = useQuieto();

  useEffect(() => {
    const seEncendio = prendido && !anterior.current;
    anterior.current = prendido;
    if (!seEncendio || sinMovimiento) return;
    const anim = Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 140, easing: SALIDA, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: T.destello - 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [prendido, v, sinMovimiento]);

  return (
    <View style={style}>
      {children}
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          // En style y no como prop: `pointerEvents` como prop esta deprecado
          // con la arquitectura nueva de React Native, que es la que usa esta
          // app. Si dejara de aplicarse, esta capa taparia los botones de cada
          // parada y el chofer no podria marcar nada.
          { pointerEvents: 'none', backgroundColor: color, borderRadius: radio, opacity: v },
        ]}
      />
    </View>
  );
}

// ─── 4. El latido de la parada que sigue ────────────────────────────────────

/**
 * Late despacio, para encontrar la parada activa sin leer toda la lista.
 * Es el mismo recurso que ya usa el mapa de la web con la parada siguiente.
 */
export function Late({ children, activo, style }: {
  children: React.ReactNode; activo: boolean; style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const sinMovimiento = useQuieto();

  useEffect(() => {
    if (!activo || sinMovimiento) { v.setValue(0); return; }
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [activo, v, sinMovimiento]);

  return (
    <Animated.View style={[style, {
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

// ─── 5. La barra de progreso ────────────────────────────────────────────────

/**
 * Crece hasta el porcentaje nuevo en vez de saltar.
 *
 * Se estira con scaleX y no con width justamente para poder usar el hilo
 * nativo: animar `width` obliga a rehacer las medidas en JavaScript en cada
 * cuadro, y en los celulares que usan los choferes eso se traba.
 *
 * Escalar agranda desde el centro, asi que ademas se corre la mitad de lo que
 * se achico: sin eso la barra crece para los dos lados.
 */
export function BarraProgreso({ porcentaje, alto = 6, color, fondo, style }: {
  porcentaje: number; alto?: number; color: string; fondo: string; style?: StyleProp<ViewStyle>;
}) {
  const p = Math.max(0, Math.min(100, porcentaje || 0)) / 100;
  const v = useRef(new Animated.Value(p)).current;
  const [ancho, setAncho] = useState(0);
  const sinMovimiento = useQuieto();

  useEffect(() => {
    if (sinMovimiento) { v.setValue(p); return; }
    const anim = Animated.timing(v, {
      toValue: p, duration: T.barra, easing: SALIDA, useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [p, v, sinMovimiento]);

  return (
    <View
      style={[{ height: alto, backgroundColor: fondo, borderRadius: 999, overflow: 'hidden' }, style as any]}
      onLayout={(e) => setAncho(e.nativeEvent.layout.width)}
    >
      {ancho > 0 ? (
        <Animated.View
          style={{
            width: ancho,
            height: '100%',
            backgroundColor: color,
            borderRadius: 999,
            transform: [
              { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-ancho / 2, 0] }) },
              { scaleX: v },
            ],
          }}
        />
      ) : (
        // Hasta que el sistema mida el ancho no se puede animar, porque la
        // cuenta del corrimiento necesita ese numero. Mientras tanto se dibuja
        // la barra quieta: vale mil veces mas ver el progreso sin animacion
        // que no ver la barra.
        <View style={{
          width: `${p * 100}%`, height: '100%', backgroundColor: color, borderRadius: 999,
        }} />
      )}
    </View>
  );
}

// ─── 6. Los numeros que suben ───────────────────────────────────────────────

/**
 * Devuelve el numero subiendo hasta el valor nuevo.
 *
 * El valor que devuelve al terminar es EXACTAMENTE el que se le paso: el
 * conteo es decoracion, el dato no se toca. Si llega un valor nuevo a mitad
 * del conteo, ese gana.
 */
export function useNumero(valor: number): number {
  const destino = Number.isFinite(valor) ? valor : 0;
  const [visible, setVisible] = useState(destino);
  // Lo que se esta MOSTRANDO ahora mismo, no el ultimo destino. Si llega un
  // valor nuevo a mitad del conteo, el conteo nuevo tiene que arrancar desde
  // el numero que el chofer esta viendo; arrancar desde el destino viejo hace
  // que el contador vaya para atras.
  const mostrado = useRef(destino);
  const sinMovimiento = useQuieto();

  const poner = useCallback((n: number) => {
    mostrado.current = n;
    setVisible(n);
  }, []);

  useEffect(() => {
    if (sinMovimiento || mostrado.current === destino) {
      poner(destino);
      return;
    }
    const inicio = mostrado.current;
    const t0 = Date.now();
    let vivo = true;
    const tic = () => {
      if (!vivo) return;
      const k = Math.min(1, (Date.now() - t0) / T.numero);
      const suave = 1 - Math.pow(1 - k, 3);
      if (k < 1) {
        poner(Math.round(inicio + (destino - inicio) * suave));
        requestAnimationFrame(tic);
      } else {
        poner(destino);                      // el valor real, sin redondeos raros
      }
    };
    requestAnimationFrame(tic);
    return () => { vivo = false; };
  }, [destino, sinMovimiento, poner]);

  return visible;
}

// ─── 7. Entrada con rebote, para los carteles importantes ───────────────────

/** Entra con un golpecito. Para "VIAJE FINALIZADO" y avisos de ese peso. */
export function Golpe({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  const sinMovimiento = useQuieto();

  useEffect(() => {
    if (sinMovimiento) { v.setValue(1); return; }
    const anim = Animated.spring(v, {
      toValue: 1, friction: 6, tension: 120, useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [v, sinMovimiento]);

  return (
    <Animated.View style={[style, {
      opacity: v,
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}
