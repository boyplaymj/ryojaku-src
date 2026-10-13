package main

import "testing"

func TestParseMaxUsers(t *testing.T) {
	if n, err := parseMaxUsers(""); err != nil || n != 20 {
		t.Errorf("沒設：n=%d err=%v，應為 20", n, err)
	}
	if n, err := parseMaxUsers("5"); err != nil || n != 5 {
		t.Errorf("5：n=%d err=%v", n, err)
	}
	if n, err := parseMaxUsers("50"); err != nil || n != hardMaxUsers {
		t.Errorf("剛好等於上限：n=%d err=%v", n, err)
	}
	// 超過上限、0、負數、不是數字：一律回錯誤，不可以悄悄夾成合法值照跑。
	for _, bad := range []string{"51", "1000", "0", "-3", "abc", "20 "} {
		if n, err := parseMaxUsers(bad); err == nil {
			t.Errorf("%q 應該被拒絕，卻得到 %d", bad, n)
		}
	}
}
