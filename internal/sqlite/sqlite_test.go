package sqlite

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestRollbackAndUnicodeBindings(t *testing.T) {
	db, e := Open(filepath.Join(t.TempDir(), "db.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	if e = db.Write(func(c *Conn) error {
		_, e := c.Exec("CREATE TABLE example(id INTEGER PRIMARY KEY,value TEXT,flag INTEGER)")
		return e
	}); e != nil {
		t.Fatal(e)
	}
	sentinel := errors.New("rollback")
	if e = db.Write(func(c *Conn) error {
		if _, e := c.Exec("INSERT INTO example(value,flag) VALUES(?,?)", "Grüße\x00世界", true); e != nil {
			return e
		}
		return sentinel
	}); !errors.Is(e, sentinel) {
		t.Fatal(e)
	}
	if e = db.Read(func(c *Conn) error {
		r, e := c.Query("SELECT count(*) AS n FROM example")
		if e != nil {
			return e
		}
		if r[0].Int("n") != 0 {
			t.Fatal("transaction was not rolled back")
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	if e = db.Write(func(c *Conn) error {
		_, e := c.Exec("INSERT INTO example(value,flag) VALUES(?,?)", "Grüße\x00世界", true)
		return e
	}); e != nil {
		t.Fatal(e)
	}
	if e = db.Read(func(c *Conn) error {
		r, e := c.Query("SELECT * FROM example")
		if e != nil {
			return e
		}
		if r[0].Text("value") != "Grüße\x00世界" || r[0].Int("flag") != 1 {
			t.Fatal(r)
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
}
