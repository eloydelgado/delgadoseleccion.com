/*
 * Formularios de contacto para la copia estática (GitHub Pages).
 *
 * Sustituye el envío de Contact Form 7 y de Divi (que necesitan WordPress)
 * por validación en el navegador + la Cloud Function `contactoWeb` del proyecto
 * Firebase grupodelgado-prod (repo `delgado`, docs/contacto-web.md), que guarda
 * la solicitud y la envía por correo. La llamada va protegida con App Check
 * (reCAPTCHA Enterprise), que se carga al empezar a rellenar un formulario.
 *
 * CONFIGURACIÓN
 *   recaptchaSiteKey: clave de sitio de reCAPTCHA Enterprise registrada en App Check.
 *                     Si se deja vacía, al enviar se abre el programa de correo
 *                     del visitante con el mensaje ya redactado (mailto) a fallbackEmail.
 */
(function () {
	'use strict';

	var CONFIG = {
		recaptchaSiteKey: '6LdxFSMuAAAAAA0ImKsJQ0ge1lWmgDTuso1crLmH',
		firebase: {
			apiKey: 'AIzaSyAUxsnbJHWXhgpdf8-WrlsZqg3YR6K56zY',
			authDomain: 'grupodelgado-prod.firebaseapp.com',
			projectId: 'grupodelgado-prod',
			appId: '1:372017317721:web:3558356a66cd5fc5166e48'
		},
		region: 'europe-west1',
		functionName: 'contactoWeb',
		sdk: 'https://www.gstatic.com/firebasejs/11.0.2/',
		fallbackEmail: 'seleccion@grupo-delgado.com'
	};

	var MSG = {
		required: 'El campo es obligatorio.',
		acceptance: 'Debes aceptar los términos y condiciones antes de enviar tu mensaje.',
		email: 'La dirección de correo electrónico no es válida.',
		tel: 'El número de teléfono no es válido.',
		pattern: 'El formato del campo no es válido.',
		invalid: 'Uno o más campos tienen un error. Por favor, revísalos e inténtalo de nuevo.',
		sent: 'Gracias por tu mensaje. Ha sido enviado.',
		failed: 'Hubo un error intentando enviar tu mensaje. Por favor, inténtalo de nuevo más tarde.',
		mailto: 'Se ha abierto tu programa de correo con el mensaje preparado. Pulsa «Enviar» en él para completar el envío.',
		diviSent: 'Gracias por contactar con nosotros.',
		diviInvalid: 'Por favor, rellena los siguientes campos:'
	};

	var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	var TEL_RE = /^[+0-9\s().\-]{6,}$/;

	function text(el) {
		return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
	}

	function isFilled(el) {
		return el.type === 'checkbox' ? el.checked : el.value.trim() !== '';
	}

	/* ---------- Descripción de campos ---------- */

	// Contact Form 7: <p>Etiqueta: <span class="wpcf7-form-control-wrap">control</span></p>
	function cf7Fields(form) {
		var out = [];
		form.querySelectorAll('.wpcf7-form-control-wrap').forEach(function (wrap) {
			var el = wrap.querySelector('input, select, textarea');
			if (!el) return;
			var label = '';
			var p = wrap.closest('p');
			if (p) {
				for (var n = p.firstChild; n && n !== wrap; n = n.nextSibling) label += n.textContent;
			}
			label = label.replace(/[:\s]+$/, '').trim();
			var isAcceptance = !!wrap.querySelector('.wpcf7-acceptance');
			out.push({
				el: el,
				wrap: wrap,
				label: label || (isAcceptance ? 'Política de privacidad' : el.name),
				required: isAcceptance || el.getAttribute('aria-required') === 'true',
				kind: isAcceptance ? 'acceptance' : el.type === 'email' ? 'email' : el.type === 'tel' ? 'tel' : 'text'
			});
		});
		return out;
	}

	// Divi: <p class="et_pb_contact_field"><label>Etiqueta</label> control</p>
	function diviFields(form) {
		var out = [];
		form.querySelectorAll('.et_pb_contact_field').forEach(function (p) {
			var handle = p.querySelector('.et_pb_checkbox_handle');
			var el = handle ? p.querySelector('input[type=checkbox]') : p.querySelector('input:not([type=hidden]), select, textarea');
			if (!el) return;
			var ref = handle || el;
			var id = (ref.getAttribute('data-original_id') || '').toLowerCase();
			out.push({
				el: el,
				wrap: p,
				label: text(p.querySelector('.et_pb_contact_form_label')).replace(/:$/, '') || id,
				required: ref.getAttribute('data-required_mark') === 'required',
				kind: handle ? 'acceptance' : /mail|correo/.test(id) ? 'email' : /tlf|tel/.test(id) ? 'tel' : 'text'
			});
		});
		return out;
	}

	function validate(field) {
		var el = field.el;
		if (field.required && !isFilled(el)) return field.kind === 'acceptance' ? MSG.acceptance : MSG.required;
		if (el.type === 'checkbox' || !el.value.trim()) return '';
		var v = el.value.trim();
		if (field.kind === 'email' && !EMAIL_RE.test(v)) return MSG.email;
		if (field.kind === 'tel' && !TEL_RE.test(v)) return MSG.tel;
		var pattern = el.getAttribute('pattern');
		if (pattern && !new RegExp('^(?:' + pattern + ')$').test(v)) return el.getAttribute('title') || MSG.pattern;
		return '';
	}

	/* ---------- Envío ---------- */

	// Lo que recibe la Cloud Function contactoWeb.
	function buildPayload(fields) {
		var email = '';
		var campos = fields.map(function (f) {
			if (f.kind === 'email' && !email) email = f.el.value.trim();
			return {
				etiqueta: f.label,
				valor: f.kind === 'acceptance' ? (f.el.checked ? 'Aceptada' : 'No aceptada') : f.el.value.trim()
			};
		});
		return {
			formulario: text(document.querySelector('h1')) || document.title,
			pagina: location.href,
			email: email,
			campos: campos
		};
	}

	// Carga Firebase + App Check una sola vez (módulos ES desde gstatic).
	var callablePromise = null;
	function getCallable() {
		if (!callablePromise) {
			callablePromise = Promise.all([
				import(CONFIG.sdk + 'firebase-app.js'),
				import(CONFIG.sdk + 'firebase-app-check.js'),
				import(CONFIG.sdk + 'firebase-functions.js')
			]).then(function (m) {
				var app = m[0].initializeApp(CONFIG.firebase, 'contacto-web');
				m[1].initializeAppCheck(app, {
					provider: new m[1].ReCaptchaEnterpriseProvider(CONFIG.recaptchaSiteKey),
					isTokenAutoRefreshEnabled: true
				});
				return m[2].httpsCallable(m[2].getFunctions(app, CONFIG.region), CONFIG.functionName);
			});
			callablePromise.catch(function () { callablePromise = null; });
		}
		return callablePromise;
	}

	function send(data) {
		if (!CONFIG.recaptchaSiteKey) {
			var body = data.campos.map(function (c) { return c.etiqueta + ': ' + c.valor; }).join('\n');
			location.href = 'mailto:' + CONFIG.fallbackEmail +
				'?subject=' + encodeURIComponent('Formulario web: ' + data.formulario) +
				'&body=' + encodeURIComponent(body);
			return Promise.resolve('mailto');
		}
		return getCallable().then(function (call) {
			return call(data);
		}).then(function () {
			return 'sent';
		});
	}

	// No se usa form.reset() ni se lanzan eventos "change": Contact Form 7 los
	// escucha y vuelve a validar (o llama a WordPress), y taparía el mensaje de éxito.
	function clearFields(fields) {
		var acceptance = false;
		fields.forEach(function (f) {
			var el = f.el;
			if (el.type === 'checkbox') el.checked = false;
			else if (el.tagName === 'SELECT') el.selectedIndex = 0;
			else el.value = '';
			if (f.kind === 'acceptance') acceptance = true;
		});
		// Como hace Contact Form 7: sin aceptar la política, el botón queda desactivado.
		var form = fields.length && fields[0].el.form;
		var button = form && form.matches('.wpcf7-form') && form.querySelector('.wpcf7-submit');
		if (acceptance && button) button.disabled = true;
	}

	/* ---------- Interfaz Contact Form 7 ---------- */

	function cf7Status(form, status, message) {
		form.classList.remove('init', 'invalid', 'sent', 'failed', 'submitting', 'validating', 'resetting');
		form.classList.add(status);
		form.setAttribute('data-status', status);
		var out = form.querySelector('.wpcf7-response-output');
		if (out) {
			out.textContent = message || '';
			out.setAttribute('aria-hidden', message ? 'false' : 'true');
		}
		var sr = form.closest('.wpcf7') && form.closest('.wpcf7').querySelector('.screen-reader-response p');
		if (sr) sr.textContent = message || '';
	}

	function cf7ClearErrors(form) {
		form.querySelectorAll('.wpcf7-not-valid-tip').forEach(function (t) { t.remove(); });
		form.querySelectorAll('.wpcf7-not-valid').forEach(function (el) {
			el.classList.remove('wpcf7-not-valid');
			el.setAttribute('aria-invalid', 'false');
		});
	}

	function handleCf7(form) {
		var fields = cf7Fields(form);
		cf7ClearErrors(form);
		var firstBad = null;
		fields.forEach(function (f) {
			var err = validate(f);
			if (!err) return;
			var target = f.kind === 'acceptance' ? f.wrap.querySelector('.wpcf7-form-control') : f.el;
			target.classList.add('wpcf7-not-valid');
			f.el.setAttribute('aria-invalid', 'true');
			var tip = document.createElement('span');
			tip.className = 'wpcf7-not-valid-tip';
			tip.textContent = err;
			f.wrap.appendChild(tip);
			firstBad = firstBad || f.el;
		});
		if (firstBad) {
			cf7Status(form, 'invalid', MSG.invalid);
			firstBad.focus();
			return;
		}
		cf7Status(form, 'submitting', '');
		form.classList.add('init'); // mantiene el estilo base mientras envía
		send(buildPayload(fields)).then(function (result) {
			if (result === 'sent') clearFields(fields);
			cf7Status(form, 'sent', result === 'mailto' ? MSG.mailto : MSG.sent);
		}, function () {
			cf7Status(form, 'failed', MSG.failed);
		});
	}

	/* ---------- Interfaz Divi ---------- */

	function handleDivi(form) {
		var container = form.closest('.et_pb_contact_form_container');
		var msgBox = container && container.querySelector('.et-pb-contact-message');
		var fields = diviFields(form);
		var bad = [];
		fields.forEach(function (f) {
			var err = validate(f);
			f.el.classList.toggle('et_contact_error', !!err);
			f.el.setAttribute('aria-invalid', err ? 'true' : 'false');
			if (err) bad.push(f);
		});
		function show(html) {
			if (!msgBox) return;
			msgBox.setAttribute('role', 'status');
			msgBox.innerHTML = html;
		}
		if (bad.length) {
			var items = bad.map(function (f) {
				var li = document.createElement('li');
				li.textContent = f.label + ' — ' + validate(f);
				return li.outerHTML;
			}).join('');
			show('<p>' + MSG.diviInvalid + '</p><ul>' + items + '</ul>');
			bad[0].el.focus();
			return;
		}
		var button = form.querySelector('[type=submit]');
		if (button) button.disabled = true;
		show('');
		send(buildPayload(fields)).then(function (result) {
			if (result === 'mailto') {
				show('<p>' + MSG.mailto + '</p>');
			} else {
				show('<p>' + MSG.diviSent + '</p>');
				var wrap = form.closest('.et_pb_contact');
				if (wrap) wrap.style.display = 'none';
			}
		}, function () {
			show('<p>' + MSG.failed + '</p>');
		}).then(function () {
			if (button) button.disabled = false;
		});
	}

	/* ---------- Enganche ----------
	 * Se escucha en fase de captura sobre window para adelantarse a los
	 * manejadores de Contact Form 7 y Divi, que intentarían enviar a WordPress.
	 */
	window.addEventListener('submit', function (e) {
		var form = e.target;
		if (!(form instanceof HTMLFormElement)) return;
		var isCf7 = form.matches('.wpcf7-form');
		var isDivi = form.matches('.et_pb_contact_form');
		if (!isCf7 && !isDivi) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		// Campo trampa antispam de Akismet: si lo rellena un bot, fingimos éxito.
		var hp = form.querySelector('[name="_wpcf7_ak_hp_textarea"]');
		if (hp && hp.value) {
			if (isCf7) cf7Status(form, 'sent', MSG.sent);
			return;
		}
		if (isCf7) handleCf7(form); else handleDivi(form);
	}, true);

	// Precarga Firebase y reCAPTCHA al empezar a rellenar un formulario, para
	// que App Check tenga su token listo al enviar (y no cargarlo en cada visita).
	window.addEventListener('focusin', function (e) {
		if (CONFIG.recaptchaSiteKey && e.target.closest && e.target.closest('.wpcf7-form, .et_pb_contact_form')) {
			getCallable().catch(function () {});
		}
	});

	// Quita los avisos de error al corregir un campo.
	window.addEventListener('input', clearOne, true);
	window.addEventListener('change', clearOne, true);
	function clearOne(e) {
		var el = e.target;
		if (!el.closest || !el.closest('.wpcf7-form, .et_pb_contact_form')) return;
		el.classList.remove('et_contact_error', 'wpcf7-not-valid');
		var wrap = el.closest('.wpcf7-form-control-wrap');
		if (wrap) {
			var tip = wrap.querySelector('.wpcf7-not-valid-tip');
			if (tip) tip.remove();
			var ctl = wrap.querySelector('.wpcf7-not-valid');
			if (ctl) ctl.classList.remove('wpcf7-not-valid');
		}
		el.setAttribute('aria-invalid', 'false');
	}
})();
