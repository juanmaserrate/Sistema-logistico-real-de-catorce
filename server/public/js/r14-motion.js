/* ============================================================================
 * R14 MOTION — el motor de las micro-interacciones
 * ============================================================================
 * Acompana a /css/r14-motion.css. La idea: que el sistema se sienta vivo sin
 * tocar ni una linea de la logica que ya funciona.
 *
 * Por que esta hecho asi (parches desde afuera y un observador del DOM) y no
 * metiendo llamadas en cada funcion: planificacion.html tiene 28.000 lineas y
 * 109 lugares distintos que muestran y esconden cosas. Tocar todos seria pedir
 * un bug. Desde afuera, lo peor que puede pasar es que una animacion no corra.
 *
 * Lo que hace:
 *   1. Cada cambio de pantalla entra con un desplazamiento suave.
 *   2. Las filas de las tablas aparecen en cascada (las tablas largas, juntas).
 *   3. "Cargando..." deja de estar quieto: brilla, y arriba de la pantalla
 *      corre una barra fina mientras el servidor contesta.
 *   4. El boton que apreto el usuario late mientras guarda, y despues saca un
 *      anillo verde si salio bien o tiembla en rojo si fallo.
 *   5. Los numeros grandes (KPI) suben hasta el valor nuevo en vez de saltar.
 *   6. Las barritas de porcentaje crecen desde cero. Esas dos llevan la
 *      clase .r14-barra-crece escrita en el HTML: son dos en todo el
 *      sistema y no vale buscarlas en cada cambio del DOM.
 *
 * Para apagarlo: R14Motion.apagar() en la consola (queda guardado), o sacar
 * las dos lineas de r14-motion del <head>.
 * ========================================================================= */
(function () {
    'use strict';

    var CLAVE = 'r14.motion';
    var raiz = document.documentElement;
    var menosMovimiento = (window.matchMedia)
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    try {
        if (localStorage.getItem(CLAVE) === 'off') raiz.setAttribute('data-r14-motion', 'off');
    } catch (_) { /* navegador sin localStorage: queda prendido */ }

    /** Apagado = lo apago el usuario, o el sistema operativo pide menos
     *  animaciones. En los dos casos no se toca nada del DOM. */
    function apagado() {
        if (raiz.getAttribute('data-r14-motion') === 'off') return true;
        return !!(menosMovimiento && menosMovimiento.matches);
    }

    /** Vuelve a disparar una animacion CSS que quizas ya corrio.
     *  El offsetWidth no es decorativo: sin leerlo el navegador junta el
     *  remove y el add en un solo paso y la animacion no arranca. */
    function disparar(el, clase) {
        if (!el || apagado()) return;
        el.classList.remove(clase);
        void el.offsetWidth;
        el.classList.add(clase);
    }

    // ═════════════════════════ 1. CAMBIO DE PANTALLA ═════════════════════════

    function engancharPantallas() {
        if (typeof window.showSection !== 'function' || window.showSection.__r14) return false;
        var original = window.showSection;
        var parcheada = function () {
            var r = original.apply(this, arguments);
            if (!apagado()) {
                var vista = document.querySelector('#main-view > div[id^="view-"]:not(.hidden)');
                disparar(vista, 'r14-pantalla-entra');
                disparar(document.getElementById('header-title'), 'r14-titulo-entra');
                disparar(document.getElementById('header-desc'), 'r14-titulo-entra');
            }
            // Por si la pantalla trae KPI o carteles que todavia no estaban
            marcarGrillas();
            engancharNumeros();
            barridoDeCarteles();
            return r;
        };
        parcheada.__r14 = true;
        window.showSection = parcheada;
        return true;
    }

    // ═════════════════════════ 2. PESTANAS INTERNAS ══════════════════════════
    // No se sabe de antemano que panel muestra cada pestana, asi que se mira:
    // se escucha el DOM SOLO mientras corre la funcion original y se anima lo
    // que haya dejado de estar oculto. Sirve igual para cualquier pestana que
    // se agregue manana.

    var FUNCIONES_PESTANA = ['ntTab', 'budgetShowTab', 'dashExcelSetTab'];

    function engancharPestanas() {
        FUNCIONES_PESTANA.forEach(function (nombre) {
            var original = window[nombre];
            if (typeof original !== 'function' || original.__r14) return;
            var parcheada = function () {
                if (apagado()) return original.apply(this, arguments);
                var observador = new MutationObserver(function () { /* se lee a mano */ });
                observador.observe(document.body, {
                    attributes: true, subtree: true, attributeFilter: ['class']
                });
                var r, registros = [];
                try {
                    r = original.apply(this, arguments);
                } finally {
                    registros = observador.takeRecords();
                    observador.disconnect();
                }
                for (var i = 0; i < registros.length; i++) {
                    var el = registros[i].target;
                    if (el && el.nodeType === 1 && !el.classList.contains('hidden')) {
                        disparar(el, 'r14-panel-entra');
                    }
                }
                return r;
            };
            parcheada.__r14 = true;
            window[nombre] = parcheada;
        });
    }

    // ═══════════ 3. OBSERVADOR: CASCADAS, CARGA Y BARRAS DE DATOS ════════════

    /** Contenedores cuyas filas/tarjetas hay que animar. Se juntan y se
     *  resuelven una sola vez por frame: si una tabla agrega 300 filas de a
     *  una, esto corre una vez, no 300. */
    var pendientes = new Set();
    var programado = false;

    /** A partir de cuantas filas la cascada se siente lenta y conviene que la
     *  tabla entre entera. El Log Semanal tiene cientos. */
    var TOPE_CASCADA = 40;

    function aplicarPendientes() {
        if (!programado) return;      // ya corrio el otro (frame o red)
        programado = false;
        pendientes.forEach(function (cont) {
            if (!cont.isConnected) return;
            if (cont.tagName === 'TBODY') {
                var filas = cont.rows ? cont.rows.length : cont.children.length;
                if (!filas) return;
                var clase = (filas <= TOPE_CASCADA) ? 'r14-cascada' : 'r14-entra-junto';
                cont.classList.remove('r14-cascada', 'r14-entra-junto');
                void cont.offsetWidth;
                cont.classList.add(clase);
            } else {
                if (!cont.children.length) return;
                disparar(cont, 'r14-cascada');
            }
        });
        pendientes.clear();
    }

    function encolar(cont) {
        if (!cont) return;
        pendientes.add(cont);
        if (!programado) {
            programado = true;
            // Se piden las dos: el frame es lo normal, el setTimeout es la red.
            // En una pestana en segundo plano el navegador congela los frames y
            // sin la red las filas se quedarian sin animar al volver.
            // El primero que corra hace el trabajo; el segundo no encuentra nada.
            requestAnimationFrame(aplicarPendientes);
            setTimeout(aplicarPendientes, 80);
        }
    }

    /** Mientras el texto siga diciendo "Cargando...", el cartel brilla. Cuando
     *  llega el dato de verdad se le saca la clase: si no, el numero real
     *  quedaria titilando como si todavia estuviera esperando. */
    function vigilarCarga(el, clase) {
        var obs = new MutationObserver(function () {
            if (!el.isConnected || !/^cargando/i.test((el.textContent || '').trim())) {
                el.classList.remove(clase);
                obs.disconnect();
            }
        });
        obs.observe(el, { childList: true, characterData: true, subtree: true });
        setTimeout(function () { obs.disconnect(); }, 90000);   // red por si nunca llega
    }

    function revisarCarga(el) {
        var esFila = (el.tagName === 'TR');
        if (!esFila && el.children.length) return;              // tiene hijos: no es un cartel
        var txt = (el.textContent || '').trim();
        if (txt.length > 44 || !/^cargando/i.test(txt)) return;

        // Una celda que dice "Cargando..." es en realidad una fila entera
        // esperando: el barrido se ve mejor sobre la fila completa.
        if (el.tagName === 'TD' && el.parentNode && el.parentNode.tagName === 'TR') el = el.parentNode;

        var clase = (el.tagName === 'TR') ? 'r14-cargando' : 'r14-cargando-txt';
        if (el.classList.contains(clase)) return;
        el.classList.add(clase);
        vigilarCarga(el, clase);
    }

    /** Los carteles que YA estaban en el HTML cuando cargo la pagina. El
     *  observador solo ve lo que se agrega despues, y varias pantallas traen
     *  su "Cargando..." escrito a mano en el HTML. */
    function barridoDeCarteles() {
        if (apagado()) return;
        var raizBarrido = document.getElementById('main-view') || document.body;
        var candidatos = raizBarrido.querySelectorAll('td, p, span, div');
        for (var i = 0; i < candidatos.length; i++) revisarCarga(candidatos[i]);
    }

    function arrancarObservador() {
        var raizObs = document.getElementById('main-view') || document.body;
        var obs = new MutationObserver(function (lotes) {
            if (apagado()) return;
            for (var i = 0; i < lotes.length; i++) {
                var nuevos = lotes[i].addedNodes;
                for (var j = 0; j < nuevos.length; j++) {
                    var n = nuevos[j];
                    if (n.nodeType !== 1) continue;
                    switch (n.tagName) {
                        case 'TR':
                            if (n.parentNode && n.parentNode.tagName === 'TBODY') encolar(n.parentNode);
                            revisarCarga(n);
                            break;
                        case 'TBODY':
                            encolar(n);
                            break;
                        case 'DIV':
                            revisarCarga(n);
                            if (n.parentNode && n.parentNode.nodeType === 1
                                && n.parentNode.hasAttribute('data-r14-cascada')) encolar(n.parentNode);
                            break;
                        case 'P':
                        case 'SPAN':
                            revisarCarga(n);
                            break;
                    }
                }
            }
        });
        obs.observe(raizObs, { childList: true, subtree: true });
    }

    /** Grillas que se dibujan solas y merecen entrar en cascada. */
    var GRILLAS = ['crates-kpis', 'crates-sim-kpis', 'ds-kpis', 'report-kpis'];
    function marcarGrillas() {
        GRILLAS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.setAttribute('data-r14-cascada', '');
        });
    }

    // ═════════════════════════════ 4. NUMEROS ════════════════════════════════

    var SELECTOR_NUM = '[id^="dash-kpi-"],[id^="payments-kpi-"],[data-r14-num]';
    var DURACION_NUM = 460;
    var yaVigilados = (typeof WeakSet === 'function') ? new WeakSet() : null;

    /** Devuelve el valor solo si el texto ES un numero (con $ o % a los
     *  costados). "—", "3 de 120 paradas" o un nombre devuelven null: esos no
     *  se cuentan, solo pegan el golpecito. */
    function valorDe(txt) {
        if (txt == null) return null;
        var s = String(txt).trim();
        if (!s || !/\d/.test(s)) return null;
        if (!/^[-+$\s]*[\d.,]+\s*%?$/.test(s)) return null;
        var n = (typeof leerNumeroAR === 'function') ? leerNumeroAR(s) : parseFloat(s);
        return (typeof n === 'number' && isFinite(n)) ? n : null;
    }

    function formatear(v, dec) {
        if (typeof numeroAR === 'function') return numeroAR(v, dec);
        return v.toFixed(dec);
    }

    function golpecito(el) {
        disparar(el, 'r14-numero-pop');
    }

    function cancelarConteo(el) {
        if (el.__r14raf) { cancelAnimationFrame(el.__r14raf); el.__r14raf = 0; }
    }

    function contar(el, desde, hasta, textoFinal) {
        // Separa "$ " / "%" del numero para poder reconstruir cada paso igual
        var m = textoFinal.match(/^([^\d\-+]*)([-+]?[\d.,]+)([\s\S]*)$/);
        var antes = m ? m[1] : '';
        var despues = m ? m[3] : '';
        var decimales = (m && m[2].indexOf(',') >= 0)
            ? Math.min(m[2].split(',')[1].length, 2)
            : 0;

        cancelarConteo(el);
        var t0 = (window.performance && performance.now) ? performance.now() : Date.now();

        var paso = function (ahora) {
            var k = Math.min(1, (ahora - t0) / DURACION_NUM);
            var suave = 1 - Math.pow(1 - k, 3);                 // frena al final
            if (k < 1) {
                var v = desde + (hasta - desde) * suave;
                el.__r14Ultimo = antes + formatear(v, decimales) + despues;
                el.textContent = el.__r14Ultimo;
                el.__r14raf = requestAnimationFrame(paso);
            } else {
                // El ultimo paso escribe EXACTAMENTE el texto que puso el
                // sistema: el conteo es decoracion, el dato no se toca.
                el.__r14Ultimo = textoFinal;
                el.textContent = textoFinal;
                el.__r14raf = 0;
                golpecito(el);
            }
        };
        el.__r14raf = requestAnimationFrame(paso);
    }

    function alCambiarNumero(el) {
        var actual = (el.textContent || '').trim();

        // Si el texto es el mismo que acabamos de escribir nosotros, el cambio
        // fue nuestro: no hay nada nuevo que animar.
        if (el.__r14raf && actual === el.__r14Ultimo) return;

        var previo = el.__r14Previo;
        el.__r14Previo = actual;
        if (apagado() || el.children.length) return;

        var hasta = valorDe(actual);
        var desde = valorDe(previo);
        if (hasta === null || desde === null || desde === hasta) {
            cancelarConteo(el);
            golpecito(el);
            return;
        }
        contar(el, desde, hasta, actual);
    }

    function engancharNumeros() {
        var lista = document.querySelectorAll(SELECTOR_NUM);
        for (var i = 0; i < lista.length; i++) {
            var el = lista[i];
            if (yaVigilados && yaVigilados.has(el)) continue;
            if (el.__r14num) continue;
            if (yaVigilados) yaVigilados.add(el);
            el.__r14num = true;
            el.__r14Previo = (el.textContent || '').trim();
            el.classList.add('r14-contando');
            (function (objetivo) {
                new MutationObserver(function () { alCambiarNumero(objetivo); })
                    .observe(objetivo, { childList: true, characterData: true, subtree: true });
            })(el);
        }
    }

    // ═══════════════ 5. BOTONES Y BARRA DE CARGA (sobre fetch) ═══════════════

    var ultimoBoton = null;
    var ultimoClick = 0;
    var VENTANA_CLICK = 1500;   // ms entre el click y el POST para atribuirselo

    document.addEventListener('click', function (e) {
        var b = (e.target && e.target.closest) ? e.target.closest('button') : null;
        if (b) { ultimoBoton = b; ultimoClick = Date.now(); }
    }, true);

    function marcarResultado(btn, bien) {
        var clase = bien ? 'r14-btn-ok' : 'r14-btn-mal';
        btn.classList.remove('r14-btn-ok', 'r14-btn-mal');
        void btn.offsetWidth;
        btn.classList.add(clase);
        setTimeout(function () { btn.classList.remove(clase); }, 900);
    }

    var barraEl = null;
    var enVuelo = 0;
    var temporizador = 0;

    function crearBarra() {
        if (document.getElementById('r14-barra-carga')) return;
        barraEl = document.createElement('div');
        barraEl.id = 'r14-barra-carga';
        barraEl.setAttribute('aria-hidden', 'true');
        document.body.appendChild(barraEl);
    }

    function subioUno() {
        enVuelo++;
        // 250ms de gracia: los pedidos rapidos no alcanzan a mostrar la barra,
        // asi no parpadea una lucecita en cada click.
        if (enVuelo === 1 && !temporizador) {
            temporizador = setTimeout(function () {
                temporizador = 0;
                if (enVuelo > 0 && barraEl && !apagado()) barraEl.classList.add('visible');
            }, 250);
        }
    }

    function bajoUno() {
        enVuelo = Math.max(0, enVuelo - 1);
        if (enVuelo === 0) {
            if (temporizador) { clearTimeout(temporizador); temporizador = 0; }
            if (barraEl) barraEl.classList.remove('visible');
        }
    }

    function engancharFetch() {
        if (!window.fetch || window.__r14MotionFetch) return;
        window.__r14MotionFetch = true;
        var base = window.fetch.bind(window);

        window.fetch = function (input, init) {
            var metodo = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            var url = (typeof input === 'string') ? input
                : (input && typeof input.url === 'string') ? input.url : '';

            // La barra solo para llamadas al propio servidor. Los mapas piden
            // sus mosaicos con fetch todo el tiempo: si contaran, la barra
            // quedaria prendida para siempre en la Torre de Control.
            var contar = url.indexOf('/api/') >= 0;
            var esGuardado = (metodo === 'POST' || metodo === 'PUT' || metodo === 'PATCH' || metodo === 'DELETE');
            var btn = (esGuardado && contar && ultimoBoton
                && (Date.now() - ultimoClick) < VENTANA_CLICK
                && ultimoBoton.isConnected && !apagado()) ? ultimoBoton : null;

            if (contar) subioUno();
            if (btn) btn.classList.add('r14-btn-trabajando');

            var cerrar = function (bien) {
                if (contar) bajoUno();
                if (btn) {
                    btn.classList.remove('r14-btn-trabajando');
                    marcarResultado(btn, bien);
                }
            };

            return base(input, init).then(function (res) {
                cerrar(!!res.ok);
                return res;
            }, function (err) {
                cerrar(false);
                throw err;
            });
        };
    }

    // ══════════════════════════════ ARRANQUE ═════════════════════════════════

    function iniciar() {
        crearBarra();
        marcarGrillas();
        arrancarObservador();
        engancharNumeros();
        barridoDeCarteles();
        engancharPestanas();
        engancharFetch();

        // showSection se define en el <script> de abajo de la pagina, que puede
        // no haber corrido todavia. Se intenta un rato y se deja de insistir.
        if (!engancharPantallas()) {
            var intentos = 0;
            var reloj = setInterval(function () {
                if (engancharPantallas() || ++intentos > 40) clearInterval(reloj);
            }, 100);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }

    // ══════════════════════════════ API chica ════════════════════════════════

    window.R14Motion = {
        /** Apaga todas las animaciones y lo recuerda en este navegador. */
        apagar: function () {
            raiz.setAttribute('data-r14-motion', 'off');
            try { localStorage.setItem(CLAVE, 'off'); } catch (_) { }
            return 'Movimiento apagado.';
        },
        /** Las vuelve a prender. */
        prender: function () {
            raiz.removeAttribute('data-r14-motion');
            try { localStorage.removeItem(CLAVE); } catch (_) { }
            return 'Movimiento prendido.';
        },
        /** Para usar a mano desde cualquier funcion nueva. */
        entra: function (el, clase) { disparar(el, clase || 'r14-panel-entra'); },
        cascada: function (el) { encolar(el); },
        revisarNumeros: engancharNumeros
    };
})();
