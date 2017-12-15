import React from 'react'; // eslint-disable-line

export default ({
    className = '',
    padding = 8,
    email_padding = 7,
    button_padding = 5,
    dark_button,
    children,
    text,
}) => (
    <form id="frm_verify_email">
        <div className="gr-row gr-row-align-center">
            <div className={`signup-box gr-${padding} gr-10-p gr-12-m gr-no-gutter ${className}`}>
                <div className="gr-row gr-padding-10" id="signup">
                    <div className={`gr-${email_padding} gr-10-m gr-centered`}>
                        <input autoComplete="off" name="email" id="email" maxLength="50" className="center-text-m" placeholder={it.L('Enter your email')} />
                    </div>
                    <div className={`gr-${button_padding} gr-8-m gr-centered`}>
                        <button className={dark_button && 'primary-bg-color'} id="btn_verify_email" type="submit">
                            {text}
                        </button>
                    </div>
                    <span className="gr-12 gr-padding-10 error-msg hint color-white center-text invisible" id="signup_error"></span>
                </div>
                {children}
            </div>
        </div>
    </form>
);