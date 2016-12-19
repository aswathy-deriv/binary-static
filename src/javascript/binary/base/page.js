var Login              = require('./login').Login;
var template           = require('./utility').template;
var parseLoginIDList   = require('./utility').parseLoginIDList;
var isStorageSupported = require('./storage').isStorageSupported;
var Store              = require('./storage').Store;
var InScriptStore      = require('./storage').InScriptStore;
var CookieStorage      = require('./storage').CookieStorage;
var localizeForLang    = require('./localize').localizeForLang;
var localize           = require('./localize').localize;
var getLanguage        = require('./language').getLanguage;
var setCookieLanguage  = require('./language').setCookieLanguage;
var GTM                = require('./gtm').GTM;
var Url                = require('./url').Url;
var Header             = require('./header').Header;
var Contents           = require('./contents').Contents;
var load_with_pjax     = require('./pjax').load_with_pjax;
var TrafficSource      = require('../common_functions/traffic_source').TrafficSource;
var japanese_client    = require('../common_functions/country_base').japanese_client;
var checkLanguage      = require('../common_functions/country_base').checkLanguage;
var ViewBalance        = require('../websocket_pages/user/viewbalance/viewbalance.init').ViewBalance;
var CashierJP          = require('../../binary_japan/cashier').CashierJP;
var Cookies            = require('../../lib/js-cookie');
var moment             = require('moment');
require('../../lib/polyfills/array.includes');
require('../../lib/polyfills/string.includes');
require('../../lib/mmenu/jquery.mmenu.min.all.js');

var SessionStore,
    LocalStore;
if (isStorageSupported(window.localStorage)) {
    LocalStore = new Store(window.localStorage);
}

if (isStorageSupported(window.sessionStorage)) {
    if (!LocalStore) {
        LocalStore = new Store(window.sessionStorage);
    }
    SessionStore = new Store(window.sessionStorage);
}

if (!SessionStore || !LocalStore) {
    if (!LocalStore) {
        LocalStore = new InScriptStore();
    }
    if (!SessionStore) {
        SessionStore = new InScriptStore();
    }
}

var TUser = (function () {
    var data = {};
    return {
        extend: function(ext) { $.extend(data, ext); },
        set   : function(a) { data = a; },
        get   : function() { return data; },
    };
})();

var User = function() {
    this.email   = Cookies.get('email');
    this.loginid = Cookies.get('loginid');
    this.loginid_array = parseLoginIDList(Cookies.get('loginid_list') || '');
    this.is_logged_in = !!(
        this.loginid &&
        this.loginid_array.length > 0 &&
        localStorage.getItem('client.tokens')
    );
};

var Client = function() {
    this.loginid      = Cookies.get('loginid');
    this.residence    = Cookies.get('residence');
    this.is_logged_in = !!(this.loginid && this.loginid.length > 0 && localStorage.getItem('client.tokens'));
};

Client.prototype = {
    show_login_if_logout: function(shouldReplacePageContents) {
        if (!this.is_logged_in && shouldReplacePageContents) {
            $('#content > .container').addClass('center-text')
                .html($('<p/>', {
                    class: 'notice-msg',
                    html : localize('Please [_1] to view this page',
                        ['<a class="login_link" href="javascript:;">' + localize('login') + '</a>']),
                }));
            $('.login_link').click(function() { Login.redirect_to_login(); });
        }
        return !this.is_logged_in;
    },
    redirect_if_is_virtual: function(redirectPage) {
        var is_virtual = this.is_virtual();
        if (is_virtual) {
            window.location.href = page.url.url_for(redirectPage || '');
        }
        return is_virtual;
    },
    redirect_if_login: function() {
        if (page.client.is_logged_in) {
            window.location.href = page.url.default_redirect_url();
        }
        return page.client.is_logged_in;
    },
    is_virtual: function() {
        return this.get_storage_value('is_virtual') === '1';
    },
    require_reality_check: function() {
        return this.get_storage_value('has_reality_check') === '1';
    },
    get_storage_value: function(key) {
        return LocalStore.get('client.' + key) || '';
    },
    set_storage_value: function(key, value) {
        return LocalStore.set('client.' + key, value);
    },
    check_storage_values: function(origin) {
        var is_ok = true;

        if (!this.get_storage_value('is_virtual') && TUser.get().hasOwnProperty('is_virtual')) {
            this.set_storage_value('is_virtual', TUser.get().is_virtual);
        }

        // currencies
        if (!this.get_storage_value('currencies')) {
            BinarySocket.send({
                payout_currencies: 1,
                passthrough      : {
                    handler: 'page.client',
                    origin : origin || '',
                },
            });
            is_ok = false;
        }

        if (this.is_logged_in) {
            if (
                !this.get_storage_value('is_virtual') &&
                Cookies.get('residence') &&
                !this.get_storage_value('has_reality_check')
            ) {
                BinarySocket.send({
                    landing_company: Cookies.get('residence'),
                    passthrough    : {
                        handler: 'page.client',
                        origin : origin || '',
                    },
                });
                is_ok = false;
            }
        }

        // website TNC version
        if (!LocalStore.get('website.tnc_version')) {
            BinarySocket.send({ website_status: 1 });
        }

        return is_ok;
    },
    response_payout_currencies: function(response) {
        if (!response.hasOwnProperty('error')) {
            this.set_storage_value('currencies', response.payout_currencies.join(','));
        }
    },
    response_landing_company: function(response) {
        if (!response.hasOwnProperty('error')) {
            var has_reality_check = response.has_reality_check;
            this.set_storage_value('has_reality_check', has_reality_check);
        }
    },
    response_authorize: function(response) {
        page.client.set_storage_value('session_start', parseInt(moment().valueOf() / 1000));
        TUser.set(response.authorize);
        if (!Cookies.get('email')) this.set_cookie('email', response.authorize.email);
        this.set_storage_value('is_virtual', TUser.get().is_virtual);
        this.check_storage_values();
        Contents.activate_by_client_type();
        Contents.activate_by_login();
        CashierJP.set_email_id();
    },
    response_get_settings: function(response) {
        page.user.first_name = response.get_settings.first_name;
        CashierJP.set_name_id();
    },
    check_tnc: function() {
        if (/user\/tnc_approvalws/.test(window.location.href) || /terms\-and\-conditions/.test(window.location.href)) return;
        if (!page.client.is_virtual() && new RegExp(page.client.loginid).test(sessionStorage.getItem('check_tnc'))) {
            var client_tnc_status   = this.get_storage_value('tnc_status'),
                website_tnc_version = LocalStore.get('website.tnc_version');
            if (client_tnc_status && website_tnc_version) {
                if (client_tnc_status !== website_tnc_version) {
                    sessionStorage.setItem('tnc_redirect', window.location.href);
                    window.location.href = page.url.url_for('user/tnc_approvalws');
                }
            }
        }
    },
    clear_storage_values: function() {
        var that  = this;
        var items = ['currencies', 'landing_company_name', 'is_virtual',
            'has_reality_check', 'tnc_status', 'session_duration_limit', 'session_start'];
        items.forEach(function(item) {
            that.set_storage_value(item, '');
        });
        localStorage.removeItem('website.tnc_version');
        sessionStorage.setItem('currencies', '');
    },
    send_logout_request: function(showLoginPage) {
        if (showLoginPage) {
            sessionStorage.setItem('showLoginPage', 1);
        }
        BinarySocket.send({ logout: '1' });
    },
    get_token: function(loginid) {
        var token,
            tokens = page.client.get_storage_value('tokens');
        if (loginid && tokens) {
            var tokensObj = JSON.parse(tokens);
            if (tokensObj.hasOwnProperty(loginid) && tokensObj[loginid]) {
                token = tokensObj[loginid];
            }
        }
        return token;
    },
    add_token: function(loginid, token) {
        if (!loginid || !token || this.get_token(loginid)) {
            return false;
        }
        var tokens = page.client.get_storage_value('tokens');
        var tokensObj = tokens && tokens.length > 0 ? JSON.parse(tokens) : {};
        tokensObj[loginid] = token;
        this.set_storage_value('tokens', JSON.stringify(tokensObj));
        return true;
    },
    set_cookie: function(cookieName, Value, domain) {
        var cookie_expire = new Date();
        cookie_expire.setDate(cookie_expire.getDate() + 60);
        var cookie = new CookieStorage(cookieName, domain);
        cookie.write(Value, cookie_expire, true);
    },
    process_new_account: function(email, loginid, token, is_virtual) {
        if (!email || !loginid || !token) {
            return;
        }
        // save token
        this.add_token(loginid, token);
        // set cookies
        this.set_cookie('email',        email);
        this.set_cookie('login',        token);
        this.set_cookie('loginid',      loginid);
        this.set_cookie('loginid_list', is_virtual ? loginid + ':V:E' : loginid + ':R:E+' + Cookies.get('loginid_list'));
        // set local storage
        GTM.set_newaccount_flag();
        localStorage.setItem('active_loginid', loginid);
        window.location.href = page.url.default_redirect_url();
    },
    can_upgrade_gaming_to_financial: function(data) {
        return (data.hasOwnProperty('financial_company') && data.financial_company.shortcode === 'maltainvest');
    },
    can_upgrade_virtual_to_financial: function(data) {
        return (data.hasOwnProperty('financial_company') && !data.hasOwnProperty('gaming_company') && data.financial_company.shortcode === 'maltainvest');
    },
    can_upgrade_virtual_to_japan: function(data) {
        return (data.hasOwnProperty('financial_company') && !data.hasOwnProperty('gaming_company') && data.financial_company.shortcode === 'japan');
    },
};

var Page = function() {
    this.is_loaded_by_pjax = false;
    this.user = new User();
    this.client = new Client();
    this.url = new Url();
    this.header = new Header({ user: this.user, client: this.client, url: this.url });
    Contents.init(this.client, this.user);
    $('#logo').on('click', function() {
        load_with_pjax(page.url.url_for(page.client.is_logged_in ? japanese_client() ? 'multi_barriers_trading' : 'trading' : ''));
    });
};

Page.prototype = {
    on_load: function() {
        this.url.reset();
        localizeForLang(getLanguage());
        this.header.on_load();
        this.on_change_loginid();
        this.record_affiliate_exposure();
        Contents.on_load();
        this.on_click_acc_transfer();
        if (this.is_loaded_by_pjax) {
            this.show_authenticate_message();
        }
        if (this.client.is_logged_in) {
            ViewBalance.init();
        } else {
            LocalStore.set('reality_check.ack', 0);
        }
        setCookieLanguage();
        if (sessionStorage.getItem('showLoginPage')) {
            sessionStorage.removeItem('showLoginPage');
            Login.redirect_to_login();
        }
        checkLanguage();
        TrafficSource.setData();
        this.endpoint_notification();
        BinarySocket.init();
        this.show_notification_outdated_browser();
    },
    on_unload: function() {
        this.header.on_unload();
        Contents.on_unload();
    },
    on_change_loginid: function() {
        var that = this;
        $('.login-id-list a').on('click', function(e) {
            e.preventDefault();
            $(this).attr('disabled', 'disabled');
            that.switch_loginid($(this).attr('value'));
        });
    },
    switch_loginid: function(loginid) {
        if (!loginid || loginid.length === 0) {
            return;
        }
        var token = page.client.get_token(loginid);
        if (!token || token.length === 0) {
            page.client.send_logout_request(true);
            return;
        }

        // cleaning the previous values
        page.client.clear_storage_values();
        sessionStorage.setItem('active_tab', '1');
        sessionStorage.removeItem('client_status');
        // set cookies: loginid, login
        page.client.set_cookie('loginid', loginid);
        page.client.set_cookie('login',   token);
        // set local storage
        GTM.set_login_flag();
        localStorage.setItem('active_loginid', loginid);
        $('.login-id-list a').removeAttr('disabled');
        page.reload();
    },
    on_click_acc_transfer: function() {
        $('#acc_transfer_submit').on('click', function() {
            var amount = $('#acc_transfer_amount').val();
            if (!/^[0-9]+\.?[0-9]{0,2}$/.test(amount) || amount < 0.1) {
                $('#invalid_amount').removeClass('invisible');
                $('#invalid_amount').show();
                return false;
            }
            $('#acc_transfer_submit').submit();
            return true;
        });
    },
    record_affiliate_exposure: function() {
        var token = this.url.param('t');
        if (!token || token.length !== 32) {
            return false;
        }
        var token_length = token.length;
        var is_subsidiary = /\w{1}/.test(this.url.param('s'));

        var cookie_token = Cookies.getJSON('affiliate_tracking');
        if (cookie_token) {
            // Already exposed to some other affiliate.
            if (is_subsidiary && cookie_token && cookie_token.t) {
                return false;
            }
        }

        // Record the affiliate exposure. Overwrite existing cookie, if any.
        var cookie_hash = {};
        if (token_length === 32) {
            cookie_hash.t = token.toString();
        }
        if (is_subsidiary) {
            cookie_hash.s = '1';
        }

        Cookies.set('affiliate_tracking', cookie_hash, {
            expires: 365, // expires in 365 days
            path   : '/',
            domain : '.' + location.hostname.split('.').slice(-2).join('.'),
        });
        return true;
    },
    reload: function(forcedReload) {
        window.location.reload(!!forcedReload);
    },
    check_new_release: function() { // calling this method is handled by GTM tags
        var last_reload = localStorage.getItem('new_release_reload_time');
        // prevent reload in less than 10 minutes
        if (last_reload && +last_reload + (10 * 60 * 1000) > moment().valueOf()) return;
        var currect_hash = $('script[src*="binary.min.js"],script[src*="binary.js"]').attr('src').split('?')[1];
        var xhttp = new XMLHttpRequest();
        xhttp.onreadystatechange = function() {
            if (+xhttp.readyState === 4 && +xhttp.status === 200) {
                var latest_hash = xhttp.responseText;
                if (latest_hash && latest_hash !== currect_hash) {
                    localStorage.setItem('new_release_reload_time', moment().valueOf());
                    page.reload(true);
                }
            }
        };
        xhttp.open('GET', page.url.url_for_static() + 'version?' + Math.random().toString(36).slice(2), true);
        xhttp.send();
    },
    endpoint_notification: function() {
        var server  = localStorage.getItem('config.server_url');
        if (server && server.length > 0) {
            var message = (/www\.binary\.com/i.test(window.location.hostname) ? '' :
                localize('This is a staging server - For testing purposes only') + ' - ') +
                localize('The server <a href="[_1]">endpoint</a> is: [_2]', [page.url.url_for('endpoint'), server]);
            $('#end-note').html(message).removeClass('invisible');
            $('#footer').css('padding-bottom', $('#end-note').height());
        }
    },
    // type can take one or more params, separated by comma
    // e.g. one param = 'authenticated', two params = 'unwelcome, authenticated'
    // match_type can be `any` `all`, by default is `any`
    // should be passed when more than one param in type.
    // `any` will return true if any of the params in type are found in client status
    // `all` will return true if all of the params in type are found in client status
    client_status_detected: function(type, match_type) {
        var client_status = sessionStorage.getItem('client_status');
        if (!client_status || client_status.length === 0) return false;
        var require_auth = /\,/.test(type) ? type.split(/, */) : [type];
        client_status = client_status.split(',');
        match_type = match_type && match_type === 'all' ? 'all' : 'any';
        for (var i = 0; i < require_auth.length; i++) {
            if (match_type === 'any' && (client_status.indexOf(require_auth[i]) > -1)) return true;
            if (match_type === 'all' && (client_status.indexOf(require_auth[i]) < 0)) return false;
        }
        return (match_type !== 'any');
    },
    show_authenticate_message: function() {
        if ($('.authenticate-msg').length !== 0) return;

        var p = $('<p/>', { class: 'authenticate-msg notice-msg' }),
            span;

        if (this.client_status_detected('unwelcome')) {
            var purchase_button = $('.purchase_button');
            if (purchase_button.length > 0 && !purchase_button.parent().hasClass('button-disabled')) {
                $.each(purchase_button, function() {
                    $(this).off('click dblclick').removeAttr('data-balloon').parent()
                        .addClass('button-disabled');
                });
            }
        }

        if (this.client_status_detected('unwelcome, cashier_locked', 'any')) {
            var if_balance_zero = $('#if-balance-zero');
            if (if_balance_zero.length > 0 && !if_balance_zero.hasClass('button-disabled')) {
                if_balance_zero.removeAttr('href').addClass('button-disabled');
            }
        }

        if (this.client_status_detected('authenticated, unwelcome', 'all')) {
            span = $('<span/>', { html: template(localize('Your account is currently suspended. Only withdrawals are now permitted. For further information, please contact [_1].', ['<a href="mailto:support@binary.com">support@binary.com</a>'])) });
        } else if (this.client_status_detected('unwelcome')) {
            span = this.general_authentication_message();
        } else if (this.client_status_detected('authenticated, cashier_locked', 'all') && /cashier\.html/.test(window.location.href)) {
            span = $('<span/>', { html: template(localize('Deposits and withdrawal for your account is not allowed at this moment. Please contact [_1] to unlock it.', ['<a href="mailto:support@binary.com">support@binary.com</a>'])) });
        } else if (this.client_status_detected('cashier_locked') && /cashier\.html/.test(window.location.href)) {
            span = this.general_authentication_message();
        } else if (this.client_status_detected('authenticated, withdrawal_locked', 'all') && /cashier\.html/.test(window.location.href)) {
            span = $('<span/>', { html: template(localize('Withdrawal for your account is not allowed at this moment. Please contact [_1] to unlock it.', ['<a href="mailto:support@binary.com">support@binary.com</a>'])) });
        } else if (this.client_status_detected('withdrawal_locked') && /cashier\.html/.test(window.location.href)) {
            span = this.general_authentication_message();
        }
        if (span) {
            $('#content > .container').prepend(p.append(span));
        }
    },
    general_authentication_message: function() {
        var span = $('<span/>', { html: template(localize('To authenticate your account, kindly email the following to [_1]:', ['<a href="mailto:support@binary.com">support@binary.com</a>'])) });
        var ul   = $('<ul/>',   { class: 'checked' });
        var li1  = $('<li/>',   { text: localize('A scanned copy of your passport, driving licence (provisional or full) or identity card, showing your name and date of birth. Your document must be valid for at least 6 months after this date.') });
        var li2  = $('<li/>',   { text: localize('A scanned copy of a utility bill or bank statement (no more than 3 months old)') });
        return span.append(ul.append(li1, li2));
    },
    show_notification_outdated_browser: function() {
        window.$buoop = {
            vs : { i: 11, f: -4, o: -4, s: 9, c: -4 },
            api: 4,
            l  : getLanguage().toLowerCase(),
            url: 'https://whatbrowser.org/',
        };
        $(document).ready(function() {
            $('body').append($('<script/>', { src: '//browser-update.org/update.min.js' }));
        });
    },
};

var page = new Page();

// LocalStorage can be used as a means of communication among
// different windows. The problem that is solved here is what
// happens if the user logs out or switches loginid in one
// window while keeping another window or tab open. This can
// lead to unintended trades. The solution is to reload the
// page in all windows after switching loginid or after logout.

// onLoad.queue does not work on the home page.
// jQuery's ready function works always.

$(document).ready(function () {
    if ($('body').hasClass('BlueTopBack')) return; // exclude BO
    // Cookies is not always available.
    // So, fall back to a more basic solution.
    var match = document.cookie.match(/\bloginid=(\w+)/);
    match = match ? match[1] : '';
    $(window).on('storage', function (jq_event) {
        switch (jq_event.originalEvent.key) {
            case 'active_loginid':
                if (jq_event.originalEvent.newValue === match) return;
                if (jq_event.originalEvent.newValue === '') {
                    // logged out
                    page.reload();
                } else if (!window.is_logging_in) {
                    // loginid switch
                    page.reload();
                }
                break;
            case 'new_release_reload_time':
                if (jq_event.originalEvent.newValue !== jq_event.originalEvent.oldValue) {
                    page.reload(true);
                }
                break;
            // no default
        }
    });
    LocalStore.set('active_loginid', match);
});

module.exports = {
    page        : page,
    TUser       : TUser,
    SessionStore: SessionStore,
    LocalStore  : LocalStore,
};
