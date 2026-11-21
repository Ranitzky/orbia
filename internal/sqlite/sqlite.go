// Package sqlite provides the small prepared-statement API Orbia needs.
// All native resources have one owner; transactions serialize on one connection.
package sqlite

/*
#cgo LDFLAGS: -lsqlite3
#include <sqlite3.h>
#include <stdlib.h>
static int bind_text(sqlite3_stmt *s, int n, const char *v, int len) {
 return sqlite3_bind_text(s, n, v, len, SQLITE_TRANSIENT);
}
*/
import "C"

import (
	"errors"
	"fmt"
	"sync"
	"unsafe"
)

type DB struct {
	mu   sync.Mutex
	conn *Conn
}
type Conn struct{ ptr *C.sqlite3 }
type Row map[string]any

func (r Row) Text(k string) string { s, _ := r[k].(string); return s }
func (r Row) Int(k string) int64   { n, _ := r[k].(int64); return n }

func Open(path string) (*DB, error) {
	p := C.CString(path)
	defer C.free(unsafe.Pointer(p))
	c := &Conn{}
	if C.sqlite3_open_v2(p, &c.ptr, C.SQLITE_OPEN_READWRITE|C.SQLITE_OPEN_CREATE|C.SQLITE_OPEN_FULLMUTEX, nil) != C.SQLITE_OK {
		err := c.err()
		if c.ptr != nil {
			C.sqlite3_close(c.ptr)
		}
		return nil, err
	}
	C.sqlite3_busy_timeout(c.ptr, 5000)
	db := &DB{conn: c}
	for _, q := range []string{"PRAGMA foreign_keys=ON", "PRAGMA journal_mode=WAL", "PRAGMA synchronous=NORMAL"} {
		if _, err := c.Exec(q); err != nil {
			db.Close()
			return nil, err
		}
	}
	return db, nil
}
func (d *DB) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.conn.ptr == nil {
		return nil
	}
	if C.sqlite3_close(d.conn.ptr) != C.SQLITE_OK {
		return d.conn.err()
	}
	d.conn.ptr = nil
	return nil
}

// Hold one SQLite snapshot across related reads.
func (d *DB) Read(fn func(*Conn) error) error  { return d.transaction("BEGIN", fn) }
func (d *DB) Write(fn func(*Conn) error) error { return d.transaction("BEGIN IMMEDIATE", fn) }

func (d *DB) transaction(begin string, fn func(*Conn) error) (err error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, err = d.conn.Exec(begin); err != nil {
		return
	}
	defer func() {
		if p := recover(); p != nil {
			d.conn.Exec("ROLLBACK")
			panic(p)
		}
		if err != nil {
			d.conn.Exec("ROLLBACK")
		}
	}()
	if err = fn(d.conn); err != nil {
		return
	}
	_, err = d.conn.Exec("COMMIT")
	return
}
func (c *Conn) err() error { return errors.New(C.GoString(C.sqlite3_errmsg(c.ptr))) }
func (c *Conn) prepare(query string, args []any) (*C.sqlite3_stmt, error) {
	q := C.CString(query)
	defer C.free(unsafe.Pointer(q))
	var s *C.sqlite3_stmt
	if C.sqlite3_prepare_v2(c.ptr, q, -1, &s, nil) != C.SQLITE_OK {
		return nil, c.err()
	}
	if int(C.sqlite3_bind_parameter_count(s)) != len(args) {
		C.sqlite3_finalize(s)
		return nil, errors.New("SQL argument count mismatch")
	}
	for i, v := range args {
		var code C.int
		switch x := v.(type) {
		case nil:
			code = C.sqlite3_bind_null(s, C.int(i+1))
		case string:
			p := C.CString(x)
			code = C.bind_text(s, C.int(i+1), p, C.int(len(x)))
			C.free(unsafe.Pointer(p))
		case int:
			code = C.sqlite3_bind_int64(s, C.int(i+1), C.sqlite3_int64(x))
		case int64:
			code = C.sqlite3_bind_int64(s, C.int(i+1), C.sqlite3_int64(x))
		case bool:
			n := 0
			if x {
				n = 1
			}
			code = C.sqlite3_bind_int(s, C.int(i+1), C.int(n))
		default:
			C.sqlite3_finalize(s)
			return nil, fmt.Errorf("unsupported SQL value %T", v)
		}
		if code != C.SQLITE_OK {
			C.sqlite3_finalize(s)
			return nil, c.err()
		}
	}
	return s, nil
}
func (c *Conn) Exec(q string, args ...any) (int64, error) {
	s, err := c.prepare(q, args)
	if err != nil {
		return 0, err
	}
	defer C.sqlite3_finalize(s)
	code := C.sqlite3_step(s)
	if code != C.SQLITE_DONE && code != C.SQLITE_ROW {
		return 0, c.err()
	}
	return int64(C.sqlite3_last_insert_rowid(c.ptr)), nil
}
func (c *Conn) Query(q string, args ...any) ([]Row, error) {
	s, err := c.prepare(q, args)
	if err != nil {
		return nil, err
	}
	defer C.sqlite3_finalize(s)
	rows := []Row{}
	for {
		code := C.sqlite3_step(s)
		if code == C.SQLITE_DONE {
			break
		}
		if code != C.SQLITE_ROW {
			return nil, c.err()
		}
		r := Row{}
		for i := C.int(0); i < C.sqlite3_column_count(s); i++ {
			key := C.GoString(C.sqlite3_column_name(s, i))
			switch C.sqlite3_column_type(s, i) {
			case C.SQLITE_INTEGER:
				r[key] = int64(C.sqlite3_column_int64(s, i))
			case C.SQLITE_NULL:
				r[key] = nil
			default:
				r[key] = C.GoStringN((*C.char)(unsafe.Pointer(C.sqlite3_column_text(s, i))), C.int(C.sqlite3_column_bytes(s, i)))
			}
		}
		rows = append(rows, r)
	}
	return rows, nil
}
