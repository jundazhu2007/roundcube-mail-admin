<?php
/**
 * country_gate — 依國家白名單/黑名單限制 Roundcube webmail 登入
 *
 * 設定由 Mail Admin 後台管理（PageWebmailPolicy），存在後端的 webmail_policy.json，
 * 這支 plugin 只在每次登入時打一次本機 API（http://127.0.0.1:8000/api/webmail-policy/check）
 * 問「這個 IP 現在准不准登入」，決策邏輯完全在後端（跟資安中心共用同一套 GeoIP/RDAP 查詢）。
 *
 * 安全設計：fail open。只要 API 逾時、連不上、回傳格式不對、或任何例外，一律當作「允許」，
 * 絕對不能因為這支 plugin 本身或後端服務出問題，就把合法使用者鎖在 webmail 外面。
 */
class country_gate extends rcube_plugin
{
    public $task = 'login';

    function init()
    {
        $this->add_hook('authenticate', [$this, 'check_country']);
    }

    function check_country($args)
    {
        $allowed = true;

        try {
            $ip = rcube_utils::remote_addr();
            $ctx = stream_context_create(['http' => ['timeout' => 3]]);
            $result = @file_get_contents(
                'http://127.0.0.1:8000/api/webmail-policy/check?ip=' . urlencode($ip),
                false,
                $ctx
            );
            if ($result !== false) {
                $data = json_decode($result, true);
                if (isset($data['allowed'])) {
                    $allowed = (bool) $data['allowed'];
                }
            }
        } catch (Throwable $e) {
            $allowed = true; // 任何例外一律放行
        }

        if (!$allowed) {
            $args['valid'] = false;
            $args['abort'] = true;
            $args['error'] = '這個地區的登入已被系統管理員限制，如有疑問請聯繫管理員';
        }

        return $args;
    }
}
